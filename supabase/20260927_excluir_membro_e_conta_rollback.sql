-- ============================================================================
-- 20260927_excluir_membro_e_conta_rollback.sql
--
-- Desfaz a parte de ESTRUTURA. Nao desfaz dados: membro e conta que a funcao
-- apagou continuam apagados.
--
-- ----------------------------------------------------------------------------
-- AVISO IMPORTANTE ANTES DE RODAR
-- ----------------------------------------------------------------------------
-- A secao 3 volta `feed_publicacoes.autor_id` para `not null on delete
-- cascade`. Se qualquer publicacao ja estiver sem autor (porque alguem foi
-- excluido desde entao), o `set not null` vai FALHAR e o rollback para ali,
-- no meio.
--
-- RODE A SECAO 1 PRIMEIRO. Se ela devolver zero linhas, o rollback completo
-- vai passar. Se devolver linhas, escolha: aceitar as publicacoes sem autor
-- (e nao rodar a secao 3), ou apontar autor_id para um perfil administrativo
-- antes de rodar.
-- ============================================================================


-- ============================================================================
-- 1) TEM PUBLICACAO SEM AUTOR?
-- ============================================================================

select count(*) as publicacoes_sem_autor
  from public.feed_publicacoes
 where autor_id is null;
-- Se > 0: a secao 3 deste arquivo vai falhar. Pare e decida.


-- ============================================================================
-- 2) FUNCAO E CHAVE DE PERMISSAO
-- ============================================================================

drop function if exists public.excluir_membro_e_conta(uuid);

delete from public.permissoes_roles where chave = 'excluir_membros';
delete from public.permissoes        where chave = 'excluir_membros';


-- ============================================================================
-- 3) VOLTA A FK DO MURAL PARA CASCADE
-- ============================================================================
-- So se a secao 1 devolveu zero.
-- ============================================================================

alter table public.feed_publicacoes
  alter column autor_id set not null;

do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname      = 'feed_publicacoes'
       and rel.relnamespace = 'public'::regnamespace
       and con.contype      = 'f'
       and con.confrelid    = 'public.profiles'::regclass
  loop
    execute format('alter table public.feed_publicacoes drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.feed_publicacoes
  add constraint feed_publicacoes_autor_id_fkey
  foreign key (autor_id) references public.profiles(id) on delete cascade;


-- ============================================================================
-- 4) POLICIES DE `membros`
-- ============================================================================
-- Volta ao estado que o repositorio define, com tem_perfil.
--
-- NAO volta a policy de DELETE que o Dashboard tinha criado ("authenticated
-- using auth.uid() is not null"). Aquela policy permitia que qualquer pessoa
-- logada apagasse qualquer membro; restaurar seria devolver a falha que esta
-- migration corrigiu. Se a sua operacao exigir o estado antigo de verdade,
-- crie a policy manualmente depois de avaliar.
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select pol.polname
      from pg_policy pol
      join pg_class rel on rel.oid = pol.polrelid
     where rel.relname      = 'membros'
       and rel.relnamespace = 'public'::regnamespace
       and pol.polcmd      in ('d', 'i')
  loop
    execute format('drop policy %I on public.membros', r.polname);
  end loop;
end $$;

create policy "Administração cadastra membros" on public.membros
  for insert to authenticated
  with check (public.tem_perfil(array['administrador','secretaria']::text[]));

create policy "Administração exclui membros" on public.membros
  for delete to authenticated
  using (public.tem_perfil(array['administrador','secretaria']::text[]));
