-- ============================================================================
-- 20260927_vincular_membros_rollback.sql
--
-- Desfaz 20260927_vincular_membros.sql.
--
-- ATENCAO: este rollback apaga as duas colunas. As linhas de membros que foram
-- criadas pelo login continuam existindo em public.membros -- elas nao sao
-- perdidas, apenas deixam de estar ligadas a conta, e voltam ao estado de
-- pre-cadastro (cadastro_completo = true para todos).
--
-- Rode a secao 4 antes de rodar o resto se quiser conferir quantas contas
-- perderam a ligacao.
-- ============================================================================


-- ============================================================================
-- 1) FUNCOES
-- ============================================================================

drop function if exists public.completar_meu_cadastro(text, text, date, text, text, text);
drop function if exists public.meu_membro();
drop function if exists public.entrar_no_membro();
drop function if exists public.email_normalizado(text);


-- ============================================================================
-- 2) INDICES
-- ============================================================================

drop index if exists public.idx_membros_user_id_uniq;
drop index if exists public.idx_membros_email_normalizado;


-- ============================================================================
-- 3) COLUNAS
-- ============================================================================

alter table public.membros
  drop column if exists cadastro_completo;

alter table public.membros
  drop column if exists user_id;
