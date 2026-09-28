-- ============================================================================
-- 20260930_unico_email_membro_rollback.sql
--
-- Desfaz 20260930_unico_email_membro.sql.
--
-- CUIDADO: este rollback so remove a RESTRICAO, e volta ao indice comum que o
-- 20260927 criou. Ele nao volta nenhum dado, porque a migration nao mexeu em
-- linhas — mas remover a restricao reintroduz o bug que ela corrigia: dois
-- membros com o mesmo email voltam a poder existir, e o login volta a responder
-- 'ambiguo' em vez de vincular.
--
-- Nao ha nada a reverter no conteudo das linhas.
-- ============================================================================

-- 1) Tirar a unicidade. IF EXISTS porque o rollback precisa rodar mesmo que a
-- migration nunca tenha sido aplicada.
drop index if exists public.idx_membros_email_normalizado;

-- 2) Recriar o indice COMUM, igual ao que 20260927_vincular_membros.sql deixou.
-- Sem este passo, a busca de entrar_no_membro perde o indice e passa a varrer a
-- tabela. Em `membros` pequena nao muda nada de visivel; com alguns milhares de
-- linhas, a tela de login fica lenta.
create index if not exists idx_membros_email_normalizado
  on public.membros (lower(btrim(coalesce(email, ''))));

-- 3) Checagem: existe 1 índice, e unico = false
-- `indisunique` é coluna de pg_index (apelidado de x). Buscar em pg_class
-- devolve 42703.
select i.relname    as indice,
       x.indisunique as unico
  from pg_class t
  join pg_index x on x.indrelid = t.oid
  join pg_class i on i.oid = x.indexrelid
 where t.relname = 'membros'
   and t.relnamespace = 'public'::regnamespace
   and i.relname = 'idx_membros_email_normalizado';
