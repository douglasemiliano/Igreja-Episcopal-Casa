-- =====================================================
-- Novo perfil: Pastor
-- Quase tudo que o administrador faz, exceto:
--   - Excluir usuários (sem política de delete em profiles)
--   - Alterar o perfil de administradores
--   - Alterar o próprio perfil
--   - Conceder o perfil 'administrador'
-- =====================================================

-- Mantém a função auxiliar disponível (criada também no RLS das outras tabelas)
create or replace function public.tem_perfil(perfis text[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = any (perfis)
  );
$$;

-- Inclui 'pastor' no check constraint de profiles.role
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor', 'leitor'));

-- =====================================================
-- Atualização de perfis:
--  - admins continuam podendo mudar qualquer perfil
--  - pastores podem mudar perfis não-administradores,
--    mas não o próprio e não podem atribuir 'administrador'
-- =====================================================
drop policy if exists "Somente admin atualiza perfis" on public.profiles;

create policy "Admin e pastor atualizam perfis" on public.profiles
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.tem_perfil(array['pastor'])
      and role <> 'administrador'
    )
  )
  with check (
    public.is_admin()
    or (
      public.tem_perfil(array['pastor'])
      and role <> 'administrador'
      and public.profiles.id <> auth.uid()
    )
  );