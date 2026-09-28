-- ============================================================================
-- 20260928_atualizacao_cadastral_rollback.sql
--
-- ATENCAO: este rollback e PARCIAL de proposito.
--
-- Desfaz o que o 20260928_atualizacao_cadastral.sql fez, mas NAO volta as
-- funcoes ao estado anterior, porque o estado anterior delas nao esta
-- guardado em lugar nenhum: 20260927_vincular_membros.sql criou as versoes
-- originais, e qualquer alteracao feita no banco desde entao (correcoes de
-- permissao, novas colunas em membros) se perderia.
--
-- O que este arquivo faz:
--   1. remove a coluna cadastro_verificado_em;
--   2. remove a funcao pular_atualizacao_cadastral();
--   3. NAO mexe em entrar_no_membro / meu_membro / completar_meu_cadastro.
--      Elas passam a devolver 'verificado' e a gravar a coluna; com a coluna
--      removida, a 2 e a 3 quebram. Se precisar delas de volta, reexecute
--      20260927_vincular_membros.sql depois deste arquivo.
--
-- Ou seja: a ordem correta de volta e
--   1) 20260927_vincular_membros_rollback.sql
--   2) 20260927_excluir_membro_e_conta_rollback.sql
--   3) este arquivo
-- e nao o contrario.
-- ============================================================================


-- 1) A funcao nova sai primeiro, para nada restar chamando coluna nenhuma.
drop function if exists public.pular_atualizacao_cadastral();


-- 2) A coluna. Sem CASCADE de proposito: se restouPolicy ou trigger
--    dependente dela, o comando para e mostra o que dependem, em vez de
--    derrubar junto.
alter table public.membros drop column if exists cadastro_verificado_em;


-- 3) Checagem: nenhuma funcao deve mais citar a coluna.
select p.proname,
       p.oid::regprocedure as assinatura
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosrc ilike '%cadastro_verificado_em%';

-- Se a consulta acima voltar linhas, ainda ha funcao que usa a coluna. A
-- 'entrar_no_membro' e a 'completar_meu_cadastro' sao esperadas aqui se voce
-- NAO executou o passo 3 do rollback. Reaplique
-- 20260927_vincular_membros.sql para limpa-las.
