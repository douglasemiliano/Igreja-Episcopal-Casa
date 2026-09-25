-- =====================================================
-- Perfis: 'leitor' -> 'membro' e nova role 'lider'
-- Agenda: todos visualizam, apenas administrador/secretaria/pastor editam
--
-- IMPORTANTE: remover o check constraint ANTES de migrar os dados.
-- =====================================================

-- 1) Remove o check constraint antigo (libera 'membro' e 'lider')
alter table public.profiles drop constraint if exists profiles_role_check;

-- 2) Migra perfis existentes de 'leitor' para 'membro'
update public.profiles set role = 'membro' where role = 'leitor';

-- 3) Recria o check constraint com as novas roles
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor', 'lider', 'membro'));

-- 4) Trigger de criação de perfil: default passa a ser 'membro'
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
    coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'membro'),
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

-- 5) Função auxiliar de role (criada antes das policies que a usam)
create or replace function public.role_em(variaveis text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = any(variaveis)
  );
$$;

-- 6) Agenda: leitura liberada para todos os autenticados
drop policy if exists "Todos leem agenda" on public.agenda_igreja;
create policy "Todos leem agenda" on public.agenda_igreja
  for select to authenticated
  using (true);

-- 7) Agenda: escrita somente para administrador, secretaria e pastor
drop policy if exists "Perfis gerenciam agenda" on public.agenda_igreja;
create policy "Perfis gerenciam agenda" on public.agenda_igreja
  for all to authenticated
  using (public.role_em(array['administrador', 'secretaria', 'pastor']))
  with check (public.role_em(array['administrador', 'secretaria', 'pastor']));

-- 8) Confirmação: roles em uso
select role, count(*) from public.profiles group by role order by role;
