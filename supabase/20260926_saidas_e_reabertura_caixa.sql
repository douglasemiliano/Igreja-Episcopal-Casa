-- Saídas de caixa e reabertura de caixa fechado.
--
-- Duas coisas nesta migration:
--
-- 1. saidas_caixa — dinheiro que SAI do caixa durante o turno (insumos,
--    compras de emergência). O campo `troco` existe porque quem tira R$ 100
--    para comprar e volta com R$ 12 não gastou R$ 100: gastou R$ 88. O que
--    entra no cálculo é sempre `valor_efetivo` (= valor - troco).
--
-- 2. reabertura — permite reabrir o caixa mais recente, fechado, para
--    registrar a quitação de um fiado. Reabrir limpa o fechamento anterior:
--    o novo fechamento sobrescreve. Isso é escolha conscious, não esquecimento.

-- ---------------------------------------------------------------------------
-- 1. Saídas de caixa
-- ---------------------------------------------------------------------------

create table if not exists public.saidas_caixa (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references public.caixas (id) on delete cascade,

  -- Quanto saiu do caixa.
  valor numeric(12, 2) not null check (valor > 0),

  -- Quanto voltou como troco. Não pode ser mais do que saiu.
  troco numeric(12, 2) not null default 0 check (troco >= 0 and troco <= valor),

  -- O que realmente foi gasto. Coluna gerada para ninguém errar a conta.
  valor_efetivo numeric(12, 2) generated always as (valor - troco) stored,

  -- Por que o dinheiro saiu. Texto livre, do jeito que a pessoa escrever.
  motivo text not null,

  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),

  -- Preenchido quando alguém corrige a saída (pegou 30, gastou 20). Guarda
  -- quando a correção aconteceu, porque mexer em número fechado precisa ser
  -- rastreável.
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz
);

create index if not exists saidas_caixa_caixa_idx
  on public.saidas_caixa using btree (caixa_id);

comment on table public.saidas_caixa is
  'Dinheiro retirado do caixa durante o turno, com o troco que voltou. '
  'O valor considerado no fechamento é valor_efetivo (valor - troco).';

-- ---------------------------------------------------------------------------
-- 2. RLS das saídas
--
-- as tabelas caixas/vendas_arrecadacao não têm RLS versionado aqui; esta é a
-- primeira do módulo com política explícita. Quem registra venda também
-- registra saída — é a mesma pessoa, no mesmo turno. Apagar saída muda número
-- já conferido, então fica com administrator e tesouraria, igual ao fechamento.
-- ---------------------------------------------------------------------------

alter table public.saidas_caixa enable row level security;

drop policy if exists saidas_caixa_select on public.saidas_caixa;
create policy saidas_caixa_select on public.saidas_caixa
  for select to authenticated
  using (public.tem_perfil(array['administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor']::text[]));

drop policy if exists saidas_caixa_insert on public.saidas_caixa;
create policy saidas_caixa_insert on public.saidas_caixa
  for insert to authenticated
  with check (
    public.tem_perfil(array['administrador', 'caixa', 'tesouraria', 'pastor']::text[])
    -- só dá para tirar dinheiro de caixa aberto
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  );

drop policy if exists saidas_caixa_update on public.saidas_caixa;
create policy saidas_caixa_update on public.saidas_caixa
  for update to authenticated
  using (
    public.tem_perfil(array['administrador', 'caixa', 'tesouraria', 'pastor']::text[])
    -- só edita saída de caixa que ainda está aberto
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  )
  with check (
    public.tem_perfil(array['administrador', 'caixa', 'tesouraria', 'pastor']::text[])
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  );

drop policy if exists saidas_caixa_delete on public.saidas_caixa;
create policy saidas_caixa_delete on public.saidas_caixa
  for delete to authenticated
  using (public.tem_perfil(array['administrador', 'tesouraria']::text[]));

-- ---------------------------------------------------------------------------
-- 3. Colunas de reabertura em caixas
-- ---------------------------------------------------------------------------

alter table public.caixas add column if not exists reaberto_em timestamptz;
alter table public.caixas add column if not exists reaberto_por uuid references auth.users (id) on delete set null;
alter table public.caixas add column if not exists observacoes_reabertura text;
alter table public.caixas add column if not exists vezes_reaberto integer not null default 0;

-- ---------------------------------------------------------------------------
-- 4. Reabrir o caixa mais recente
--
-- Três travas, todas acordadas:
--   - só administrador ou tesouraria (o mesmo par que fecha o caixa);
--   - não pode haver outro caixa aberto;
--   - só o caixa mais recente, que é o caso "a pessoa pagou no dia seguinte".
--
-- O fechamento anterior é apagado: o novo fechamento sobrescreve. Se a
-- reabertura for um engano, o caixa volta a ser fechado sem rastro — por isso
-- a observação é obrigatória.
-- ---------------------------------------------------------------------------

create or replace function public.reabrir_caixa(
  p_caixa_id uuid,
  p_observacoes text default null::text
)
returns public.caixas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caixa public.caixas;
  v_mais_recente uuid;
begin
  if not public.tem_perfil(array['administrador', 'tesouraria']::text[]) then
    raise exception 'Apenas administrador ou tesouraria podem reabrir o caixa.';
  end if;

  if exists (select 1 from public.caixas where status = 'aberto') then
    raise exception 'Já existe um caixa aberto. Feche-o antes de reabrir outro.';
  end if;

  select id into v_caixa
  from public.caixas
  where id = p_caixa_id
  for update;

  if v_caixa is null then
    raise exception 'Caixa não encontrado.';
  end if;

  if v_caixa.status = 'aberto' then
    raise exception 'Este caixa já está aberto.';
  end if;

  -- Trava do "dia seguinte": o caixa reabrível é sempre o mais recente.
  select id into v_mais_recente
  from public.caixas
  order by aberto_em desc
  limit 1;

  if v_mais_recente is distinct from p_caixa_id then
    raise exception 'Só é possível reabrir o caixa mais recente, para não bagunçar a contagem dos caixas seguintes.';
  end if;

  if nullif(trim(coalesce(p_observacoes, '')), '') is null then
    raise exception 'Escreva o motivo da reabertura.';
  end if;

  update public.caixas
  set status = 'aberto',
      reaberto_em = now(),
      reaberto_por = auth.uid(),
      observacoes_reabertura = trim(p_observacoes),
      vezes_reaberto = vezes_reaberto + 1,
      -- o fechamento anterior não vale mais: será substituído
      fechado_por = null,
      fechado_em = null,
      valor_fechamento_informado = null,
      valor_esperado = null,
      diferenca = null,
      observacoes_fechamento = null
  where id = p_caixa_id
  returning * into v_caixa;

  return v_caixa;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Fechamento agora desconta as saídas
--
-- Sem isto, tirar dinheiro para comprar insumo faria o fechamento acusar uma
-- diferença falsa: o dinheiro saiu da gaveta de propósito, mas a conta não o
-- desconta. O esperado passa a ser:
--
--     valor de abertura + vendas pagas em dinheiro - saídas efetivas
--
-- Só dinheiro entra, porque só dinheiro fica na gaveta. Pix e débito são
-- receita da ação, mas não ocupam espaço no caixa.
-- ---------------------------------------------------------------------------

create or replace function public.fechar_caixa(
  p_valor_fechamento numeric,
  p_observacoes text default null::text
)
returns public.caixas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caixa_id uuid;
  v_total_dinheiro numeric;
  v_total_saidas numeric;
  v_caixa public.caixas;
begin
  if not public.tem_perfil(array['administrador', 'tesouraria']::text[]) then
    raise exception 'Apenas administrador ou tesouraria podem fechar o caixa.';
  end if;

  select id into v_caixa_id
  from public.caixas
  where status = 'aberto';

  if v_caixa_id is null then
    raise exception 'Não há caixa aberto para fechar.';
  end if;

  -- só entradas em dinheiro entram na conferência física do caixa
  select coalesce(sum(total), 0) into v_total_dinheiro
  from public.vendas_arrecadacao
  where caixa_id = v_caixa_id
    and status = 'pago'
    and forma_pagamento = 'dinheiro';

  -- o que saiu da gaveta para comprar, descontando o troco que voltou
  select coalesce(sum(valor_efetivo), 0) into v_total_saidas
  from public.saidas_caixa
  where caixa_id = v_caixa_id;

  update public.caixas
  set status = 'fechado',
      fechado_por = auth.uid(),
      fechado_em = now(),
      valor_fechamento_informado = p_valor_fechamento,
      valor_esperado = valor_abertura + v_total_dinheiro - v_total_saidas,
      diferenca = p_valor_fechamento - (valor_abertura + v_total_dinheiro - v_total_saidas),
      observacoes_fechamento = p_observacoes
  where id = v_caixa_id
  returning * into v_caixa;

  return v_caixa;
end;
$$;

revoke all on function public.reabrir_caixa (uuid, text) from public;
grant execute on function public.reabrir_caixa (uuid, text) to authenticated;
