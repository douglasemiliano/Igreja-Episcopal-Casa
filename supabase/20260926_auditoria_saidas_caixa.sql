-- =====================================================
-- Saída de caixa: colunas de auditoria e o erro PGRST204
--
-- Sintoma: editar uma saída de caixa falha com
--   PGRST204 "Could not find the 'atualizado_em' column of
--   'saidas_caixa' in the schema cache"
-- e a correção não fica registrada.
--
-- Causa: o front-end mandava `atualizado_por` e `atualizado_em` dentro
-- do .update(). Duas bobagens:
--   1) a interface SaidaCaixa nem declara esses campos e nenhum
--      template os exibe — o front-end enviava dado que ninguém lê;
--   2) o PostgREST valida o payload contra o schema cache, então uma
--      coluna ausente no cache derruba a edição inteira.
--
-- Além disso, campo de auditoria enviado pelo cliente é falsificável:
-- dava para dar "atualizado_em" de uma semana atrás e apagar o rastro
-- de um número de gaveta. A migration original diz, com razão, que
-- "mexer em número fechado precisa ser rastreável" — rastreabilidade
-- que o próprio cliente podia reescrever não é rastreabilidade.
--
-- A correção: o banco passa a carimbar quem editou e quando, num
-- BEFORE UPDATE. O front-end volta a mandar só valor, troco e motivo.
-- É o mesmo padrão já usado em feed_publicacoes
-- (public.tocar_atualizado_em).
--
-- `add column if not exists` cobre o outro cenário possível: a coluna
-- nunca ter chegado a ser criada no banco. Script idempotente.
-- =====================================================

-- 1) Garante que as duas colunas existam de fato
alter table public.saidas_caixa
  add column if not exists atualizado_por uuid references auth.users (id) on delete set null;

alter table public.saidas_caixa
  add column if not exists atualizado_em timestamptz;

-- 2) Quem editou e quando saem daqui, não do cliente
create or replace function public.marcar_saida_editada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_por := auth.uid();
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists saidas_caixa_marca_edicao on public.saidas_caixa;
create trigger saidas_caixa_marca_edicao
  before update on public.saidas_caixa
  for each row execute function public.marcar_saida_editada();

-- 3) Recarrega o cache do PostgREST: sem isso o PGRST204 continua
--    mesmo com a coluna existindo.
notify pgrst, 'reload schema';

-- 4) Confirmação
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'saidas_caixa'
  and column_name like 'atualizado%'
order by column_name;
