-- =====================================================
-- DIAGNÓSTICO (somente leitura, nada é alterado)
-- Objetivo: localizar todo objeto do schema public que ainda
-- referencia a coluna REMOVIDA `public.profiles.role`.
-- Os 3 blocos AbORTAM se a coluna `role` ainda existir —
-- nesse caso este script não se aplica.
-- =====================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) then
    raise exception 'ATENCAO: profiles.role ainda existe. Este diagnostico so vale depois do drop column.';
  end if;
end $$;

-- 1) Colunas de profiles (estado atual)
select column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- 2) POLICIES que ainda citam a coluna antiga (`role` sem `roles`)
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual        as usando,
  with_check  as com_check
from pg_policies
where schemaname = 'public'
  and (
    (qual ~* '\brole\b' and qual !~* 'roles')
    or (with_check ~* '\brole\b' and with_check !~* 'roles')
  )
order by tablename, policyname;

-- 3) FUNCOES cujo corpo ainda cita `role`
select
  n.nspname as schema,
  p.proname as funcao,
  pg_get_function_identity_arguments(p.oid) as argumentos,
  p.prosecdef as security_definer,
  p.prosrc as corpo
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosrc ~* '\brole\b'
  and p.prosrc !~* 'roles'
order by p.proname;

-- 4) VIEWS / MATERIALIZED VIEWS com a coluna antiga
select
  c.relname as objeto,
  c.relkind::text as tipo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v', 'm')
  and pg_get_viewdef(c.oid) ~* '\brole\b'
  and pg_get_viewdef(c.oid) !~* 'roles';

-- 5) TRIGGERS em tabelas de caixa/arrecadacao (podem consultar role no corpo)
select
  c.relname as tabela,
  t.tgname  as trigger,
  pg_get_triggerdef(t.oid) as definicao
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and c.relname in ('caixas', 'vendas_arrecadacao', 'itens_venda_arrecadacao');

-- 6) Estrutura atual de `caixas` (necessario para reconstruir as funcoes)
select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'caixas'
order by ordinal_position;

-- 7) Definicao completa de abrir_caixa / fechar_caixa
select pg_get_functiondef(p.oid) as definicao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('abrir_caixa', 'fechar_caixa');
