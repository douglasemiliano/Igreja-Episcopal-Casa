-- =====================================================
-- Ativa RLS em tabelas que estavam sem proteção:
-- livros, membros e registros_batismo
-- =====================================================

-- Função auxiliar para verificar se o usuário tem um dos perfis.
-- security definer para ler `profiles` sem recursão de RLS.
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

-- =====================================================
-- MEMBROS
-- Leitura: qualquer usuário autenticado
-- Escrita: somente administrador e secretaria
-- =====================================================
alter table public.membros enable row level security;

drop policy if exists "Usuários autenticados consultam membros" on public.membros;
create policy "Usuários autenticados consultam membros" on public.membros
  for select to authenticated using (true);

drop policy if exists "Administração cadastra membros" on public.membros;
create policy "Administração cadastra membros" on public.membros
  for insert to authenticated
  with check (public.tem_perfil(array['administrador', 'secretaria']));

drop policy if exists "Administração atualiza membros" on public.membros;
create policy "Administração atualiza membros" on public.membros
  for update to authenticated
  using (public.tem_perfil(array['administrador', 'secretaria']))
  with check (public.tem_perfil(array['administrador', 'secretaria']));

drop policy if exists "Administração exclui membros" on public.membros;
create policy "Administração exclui membros" on public.membros
  for delete to authenticated
  using (public.tem_perfil(array['administrador', 'secretaria']));

-- =====================================================
-- REGISTROS_BATISMO
-- Leitura: qualquer usuário autenticado
-- Escrita: somente administrador e secretaria
-- =====================================================
alter table public.registros_batismo enable row level security;

drop policy if exists "Usuários autenticados consultam registros de batismo" on public.registros_batismo;
create policy "Usuários autenticados consultam registros de batismo" on public.registros_batismo
  for select to authenticated using (true);

drop policy if exists "Administração cadastra registros de batismo" on public.registros_batismo;
create policy "Administração cadastra registros de batismo" on public.registros_batismo
  for insert to authenticated
  with check (public.tem_perfil(array['administrador', 'secretaria']));

drop policy if exists "Administração atualiza registros de batismo" on public.registros_batismo;
create policy "Administração atualiza registros de batismo" on public.registros_batismo
  for update to authenticated
  using (public.tem_perfil(array['administrador', 'secretaria']))
  with check (public.tem_perfil(array['administrador', 'secretaria']));

drop policy if exists "Administração exclui registros de batismo" on public.registros_batismo;
create policy "Administração exclui registros de batismo" on public.registros_batismo
  for delete to authenticated
  using (public.tem_perfil(array['administrador', 'secretaria']));

-- =====================================================
-- LIVROS
-- Leitura: qualquer usuário autenticado
-- Escrita: somente administrador e secretaria
-- =====================================================
alter table public.livros enable row level security;

drop policy if exists "Usuários autenticados consultam livros" on public.livros;
create policy "Usuários autenticados consultam livros" on public.livros
  for select to authenticated using (true);

drop policy if exists "Administração cadastra livros" on public.livros;
create policy "Administração cadastra livros" on public.livros
  for insert to authenticated
  with check (public.tem_perfil(array['administrador', 'secretaria']));

drop policy if exists "Administração atualiza livros" on public.livros;
create policy "Administração atualiza livros" on public.livros
  for update to authenticated
  using (public.tem_perfil(array['administrador', 'secretaria']))
  with check (public.tem_perfil(array['administrador', 'secretaria']));

drop policy if exists "Administração exclui livros" on public.livros;
create policy "Administração exclui livros" on public.livros
  for delete to authenticated
  using (public.tem_perfil(array['administrador', 'secretaria']));