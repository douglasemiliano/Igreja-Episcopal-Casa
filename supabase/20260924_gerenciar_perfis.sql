-- =====================================================
-- Gerenciamento de perfis (roles) por administrador
-- =====================================================

-- 1) Email nos perfis (para a tela de gerenciamento)
alter table public.profiles add column if not exists email text;

-- 2) Trigger: cria o perfil automaticamente quando um novo usuário é criado
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, nome, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'leitor'),
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      split_part(coalesce(new.email, 'usuario'), '@', 1)
    ),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        nome  = coalesce(public.profiles.nome, excluded.nome);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Função do Supabase: somente admins gerenciam perfis
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'administrador'
  );
$$;

-- 4) Políticas de escrita em profiles: somente administrador
drop policy if exists "Somente admin insere perfis" on public.profiles;
create policy "Somente admin insere perfis" on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Somente admin atualiza perfis" on public.profiles;
create policy "Somente admin atualiza perfis" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5) Garantir que todos os usuários existentes tenham perfil
--    (não sobrescreve roles já definidos — apenas preenche o que falta)
insert into public.profiles (id, role, nome, email)
select
  u.id,
  'leitor',
  coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email, 'usuario'), '@', 1)),
  u.email
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      nome  = coalesce(public.profiles.nome, excluded.nome);

-- =====================================================
-- DEPOIS de aplicar este script, rode no SQL Editor do
-- Supabase para marcar você mesmo como administrador:
--
--   update public.profiles
--   set role = 'administrador'
--   where id = auth.uid();
--
-- (ou use o id do usuário se preferir via Dashboard)
-- =====================================================