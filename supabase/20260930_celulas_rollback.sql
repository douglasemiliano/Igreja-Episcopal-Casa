-- 20260930_celulas_rollback.sql
-- ============================================================================
-- Desfaz 20260930_celulas.sql.
--
-- Ordem importa: as policies chamam public.lider_da_celula(), então as
-- policies saem ANTES de a função. Derrubar a função primeiro deixaria as
-- policies apontando para um nome inexistente e qualquer insert em
-- celula_membros passaria a dar erro de função.
--
-- As permissões do catálogo saem por último, e as concessões antes do catálogo:
-- a FK de permissoes_roles impede remover a chave enquanto alguém a referenciava.
-- ============================================================================


-- =====================================================
-- 1) POLICIES E RLS
-- =====================================================
drop policy if exists "Quem gerencia celulas apaga celulas"        on public.celulas;
drop policy if exists "Quem gerencia celulas atualiza celulas"     on public.celulas;
drop policy if exists "Quem gerencia celulas insere celulas"        on public.celulas;
drop policy if exists "Autenticados consultam celulas"              on public.celulas;

drop policy if exists "Quem vincula membros remove de celulas"      on public.celula_membros;
drop policy if exists "Quem vincula membros atualiza celulas"      on public.celula_membros;
drop policy if exists "Quem vincula membros insere em celulas"      on public.celula_membros;
drop policy if exists "Autenticados consultam celula_membros"       on public.celula_membros;


-- =====================================================
-- 2) FUNCOES
-- =====================================================
drop function if exists public.lider_da_celula(uuid);
drop function if exists public.minhas_celulas();


-- =====================================================
-- 3) TABELAS
-- =====================================================
-- O drop de celula_membros vem primeiro porque a FK de membro_id aponta para
-- public.membros e a de celula_id para public.celulas. Derrubar celulas com a
-- junção no lugar funcionaria por causa do on delete cascade, mas deixar a
-- tabela filha viva e sem a mãe é estado que ninguém quer.
--
-- ATENÇÃO: isto apaga as células e as participações cadastradas. Não há como
-- desfazer a perda dos dados depois de rodar.
drop table if exists public.celula_membros;
drop table if exists public.celulas;


-- =====================================================
-- 4) CATALOGO DE PERMISSOES
-- =====================================================
delete from public.permissoes_roles
 where chave in ('gerenciar_celulas', 'vincular_membros_celula');

delete from public.permissoes
 where chave in ('gerenciar_celulas', 'vincular_membros_celula');

-- A auditoria registra concessões revogadas, então o histórico fica. Se
-- quiser o histórico limpo também, é o delete abaixo. O padrão é preservar:
-- o rastro de quem concedeu o que é o que a tabela existe para guardar.
-- delete from public.permissoes_auditoria
--  where chave in ('gerenciar_celulas', 'vincular_membros_celula');
