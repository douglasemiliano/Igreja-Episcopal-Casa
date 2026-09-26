-- =====================================================
-- Correção das permissões de caixa.
--
-- `abrir_caixa` e `fechar_caixa` ainda liam a coluna REMOVIDA
-- public.profiles.role (virou public.profiles.roles text[] em
-- 20260925_roles_multiplas_e_feed.sql). Por serem plpgsql, a
-- referência só era resolvida em tempo de execução, o que
-- quebrava a RPC com 42703 ("column role does not exist") e
-- devolvia HTTP 400 — o modal de abertura fechava com
-- "Não foi possível abrir o caixa".
--
-- A troca `role = 'x'` -> `public.tem_perfil(array['x'])` mantém
-- exatamente a mesma regra: administrador OU tesouraria.
-- Nenhuma outra lógica das funções foi alterada.
-- Script idempotente.
-- =====================================================

-- =====================================================
-- 1) abrir_caixa
-- =====================================================
create or replace function public.abrir_caixa(
  p_valor_abertura numeric,
  p_observacoes text default null::text
)
returns caixas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caixa public.caixas;
begin
  if not public.tem_perfil(array['administrador', 'tesouraria']::text[]) then
    raise exception 'Apenas administrador ou tesouraria podem abrir o caixa.';
  end if;

  if exists (select 1 from public.caixas where status = 'aberto') then
    raise exception 'Já existe um caixa aberto.';
  end if;

  insert into public.caixas (aberto_por, valor_abertura, observacoes_abertura)
  values (auth.uid(), p_valor_abertura, p_observacoes)
  returning * into v_caixa;

  return v_caixa;
end;
$$;

-- =====================================================
-- 2) fechar_caixa
-- =====================================================
create or replace function public.fechar_caixa(
  p_valor_fechamento numeric,
  p_observacoes text default null::text
)
returns caixas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caixa_id uuid;
  v_total_dinheiro numeric;
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

  update public.caixas
  set status = 'fechado',
      fechado_por = auth.uid(),
      fechado_em = now(),
      valor_fechamento_informado = p_valor_fechamento,
      valor_esperado = valor_abertura + v_total_dinheiro,
      diferenca = p_valor_fechamento - (valor_abertura + v_total_dinheiro),
      observacoes_fechamento = p_observacoes
  where id = v_caixa_id
  returning * into v_caixa;

  return v_caixa;
end;
$$;

-- =====================================================
-- 3) Conferência: nenhuma referência a profiles.role deve restar
-- =====================================================
do $$
declare
  v_restos text;
begin
  select string_agg(p.proname, ', ')
  into v_restos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~* '\brole\b'
    and p.prosrc !~* 'roles';

  if v_restos is not null then
    raise warning 'Ainda referenciam profiles.role: %', v_restos;
  else
    raise notice 'OK: nenhuma funcao de public referencia mais profiles.role.';
  end if;
end $$;
