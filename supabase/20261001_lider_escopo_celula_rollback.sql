-- 20261001_lider_escopo_celula_rollback.sql
-- ============================================================================
-- Desfaz 20261001_lider_escopo_celula.sql.
--
-- Ordem importa em dois pontos:
--
--   * As policies chamam public.pode_vincular_esta_celula(), então as policies
--     saem ANTES de a função. Derrubar a função primeiro deixaria as policies
--     apontando para um nome inexistente, e qualquer insert em celula_membros
--     passaria a dar erro de função.
--
--   * As funções saem na ordem inversa da dependência: primeiro a que as
--     policies usavam, depois a que dependia de public.tem_perfil, e por último
--     a lista de papéis, que é a base das duas.
--
-- O que o rollback NÃO faz, de propósito: devolver
-- `vincular_membros_celula` para `lider` e `membro`. A delete da seção 4 da
-- migration removeu concessões que eram escalada, e restaurar a regra antiga
-- é justamente recolocar o buraco. Se a igreja quiser essa concessão de
-- volta, é decisão nova — e mesmo assim só teria efeito para os papéis de
-- direção, porque pode_formar_qualquer_celula() é quem filtra.
-- ============================================================================


-- =====================================================
-- 1) AS POLICIES VOLTAM AO TEXTO ANTERIOR
-- =====================================================
-- Mesmos nomes de 20260930_celulas.sql. O nome importa porque é ele que o
-- PostgREST devolve no erro de RLS, e quem lê o erro no console precisa
-- encontrar a policy que recusou a operação.

drop policy if exists "Quem forma a celula remove membros"   on public.celula_membros;
create policy "Quem vincula membros remove de celulas" on public.celula_membros
  for delete to authenticated
  using (
    public.pode('vincular_membros_celula')
    or public.lider_da_celula(celula_id)
  );

drop policy if exists "Quem forma a celula promove membros"  on public.celula_membros;
create policy "Quem vincula membros atualiza celulas" on public.celula_membros
  for update to authenticated
  using (
    public.pode('vincular_membros_celula')
    or public.lider_da_celula(celula_id)
  )
  with check (
    public.pode('vincular_membros_celula')
    or public.lider_da_celula(celula_id)
  );

drop policy if exists "Quem forma a celula insere membros"   on public.celula_membros;
create policy "Quem vincula membros insere em celulas" on public.celula_membros
  for insert to authenticated
  with check (
    public.pode('vincular_membros_celula')
    or public.lider_da_celula(celula_id)
  );


-- =====================================================
-- 2) AS FUNCOES
-- =====================================================
drop function if exists public.pode_vincular_esta_celula(uuid);
drop function if exists public.pode_formar_qualquer_celula();
drop function if exists public.papeis_que_formam_qualquer_celula();


-- =====================================================
-- 3) O CATALOGO VOLTA A DESCREVER A CHAVE COMO ANTES
-- =====================================================
update public.permissoes
   set descricao = 'Adicionar, remover e promover membros dentro das células'
 where chave = 'vincular_membros_celula';


-- =====================================================
-- 4) RECARREGA O CACHE DO PostgREST
-- =====================================================
notify pgrst, 'reload schema';


-- =====================================================
-- 5) CHECAGEM
-- =====================================================
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('papeis_que_formam_qualquer_celula',
                     'pode_formar_qualquer_celula',
                     'pode_vincular_esta_celula');
-- esperado: vazio

select policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename = 'celula_membros'
 order by cmd;
-- esperado: 4 linhas, nenhuma com 'Quem forma a celula' no nome.
