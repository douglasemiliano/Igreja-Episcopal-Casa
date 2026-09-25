-- =====================================================
-- Perfis múltiplos: profiles.role (text) -> profiles.roles (text[])
-- Motivação: um usuário pode acumular perfis (ex.: tesoureira + líder).
--
-- ORDEM IMPORTA: remover o check constraint antes de migrar dados.
-- Este script é idempotente.
-- =====================================================

-- 0) Policies que referenciam a coluna `role` precisam sair ANTES
--    do drop column (senão o Postgres bloqueia com 2BP01).
drop policy if exists "Admin e pastor atualizam perfis" on public.profiles;
drop policy if exists "Somente admin atualiza perfis" on public.profiles;
drop policy if exists "Somente admin insere perfis" on public.profiles;
drop policy if exists "Usuários autenticados consultam perfis" on public.profiles;

-- 1) Coluna nova (text[]) — SEM default e nullable por enquanto,
--    para que a migração de dados não seja sobrescrita pelo default.
alter table public.profiles add column if not exists roles text[];

-- 2) Migrar os dados da coluna antiga para a nova
--    'leitor' (antigo) vira 'membro'.
--    O bloco só age se a coluna `role` ainda existir (script idempotente).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) then
    execute $migra$
      update public.profiles
      set roles = array[
        case when profiles.role = 'leitor' then 'membro' else profiles.role end
      ]::text[]
    $migra$;
  end if;
end $$;

-- 3) Garante valor para quem ficou sem roles
update public.profiles
set roles = array['membro']::text[]
where roles is null or cardinality(roles) = 0;

alter table public.profiles alter column roles set default array['membro']::text[];
alter table public.profiles alter column roles set not null;

-- 4) Remover a coluna antiga e seu check constraint
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop column if exists role;

-- 5) Check constraint sobre o array: apenas roles conhecidas
alter table public.profiles drop constraint if exists profiles_roles_check;
alter table public.profiles
  add constraint profiles_roles_check
  check (
    roles <@ array['administrador','secretaria','caixa','tesouraria','pastor','lider','membro']::text[]
    and cardinality(roles) > 0
  );

-- Índice para busca por role específica
create index if not exists profiles_roles_idx on public.profiles using gin (roles);

-- 5) Trigger de criação de perfil: default 'membro' (aceita múltiplas roles do metadata)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role_lista text[];
begin
  -- metadata pode trazer 'role' (string) ou 'roles' (array)
  if new.raw_user_meta_data ? 'roles' then
    select coalesce(array_agg(value::text), array['membro']::text[])
      into role_lista
      from jsonb_array_elements_text(new.raw_user_meta_data->'roles') as value;
  elsif coalesce(new.raw_user_meta_data->>'role', '') <> '' then
    role_lista := array[new.raw_user_meta_data->>'role'];
  else
    role_lista := array['membro'];
  end if;

  -- normaliza 'leitor' -> 'membro'
  select coalesce(array_agg(
    case when r = 'leitor' then 'membro' else r end
  order by r), array['membro']::text[])
    into role_lista
    from unnest(role_lista) as r;

  insert into public.profiles (id, roles, nome, email)
  values (
    new.id,
    role_lista,
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

-- 6) Funções de permissão: agora operam sobre o array (operador && = interseção)
--    security definer para ler `profiles` sem recursão de RLS.
create or replace function public.tem_perfil(perfis text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and profiles.roles && perfis
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.tem_perfil(array['administrador']::text[]);
$$;

-- Compatibilidade: função usada pelas policies de agenda
create or replace function public.role_em(variaveis text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.tem_perfil(variaveis);
$$;

-- 7) Recria as policies de perfis (a de update usava a coluna `role`)
create policy "Usuários autenticados consultam perfis" on public.profiles
  for select to authenticated using (true);

-- admins mudam qualquer perfil;
-- pastores mudam perfis não-administradores, mas não o próprio
-- e não podem atribuir 'administrador'
create policy "Admin e pastor atualizam perfis" on public.profiles
  for update to authenticated
  using (
    public.is_admin()
    or (public.tem_perfil(array['pastor']) and not (roles && array['administrador']))
  )
  with check (
    public.is_admin()
    or (
      public.tem_perfil(array['pastor'])
      and not (roles && array['administrador'])
      and public.profiles.id <> auth.uid()
    )
  );

-- 8) Garante que todo usuário autenticado tenha ao menos um perfil
insert into public.profiles (id, roles, nome, email)
select
  u.id,
  array['membro']::text[],
  coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email, 'usuario'), '@', 1)),
  u.email
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      nome  = coalesce(public.profiles.nome, excluded.nome);

-- =====================================================
-- FEED / MURAL
-- Todos os autenticados visualizam.
-- Apenas administrador e líder publicam, editam e removem.
-- =====================================================
create table if not exists public.feed_publicacoes (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid not null references public.profiles(id) on delete cascade,
  conteudo text not null check (char_length(trim(conteudo)) > 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- A tabela pode ter sido criada antes apontando para auth.users, o que
-- impede o PostgREST de resolver o join com profiles (PGRST200).
-- Ajusta a FK para public.profiles.
delete from public.feed_publicacoes f
where not exists (select 1 from public.profiles p where p.id = f.autor_id);

alter table public.feed_publicacoes
  drop constraint if exists feed_publicacoes_autor_id_fkey;
alter table public.feed_publicacoes
  add constraint feed_publicacoes_autor_id_fkey
  foreign key (autor_id) references public.profiles(id) on delete cascade;

create index if not exists feed_publicacoes_criado_em_idx
  on public.feed_publicacoes (criado_em desc);

alter table public.feed_publicacoes enable row level security;

drop policy if exists "Todos autenticados leem o feed" on public.feed_publicacoes;
create policy "Todos autenticados leem o feed" on public.feed_publicacoes
  for select to authenticated using (true);

drop policy if exists "Administrador e líder publicam no feed" on public.feed_publicacoes;
create policy "Administrador e líder publicam no feed" on public.feed_publicacoes
  for insert to authenticated
  with check (
    public.tem_perfil(array['administrador', 'lider'])
    and autor_id = auth.uid()
  );

drop policy if exists "Autor ou administrador editam publicação" on public.feed_publicacoes;
create policy "Autor ou administrador editam publicação" on public.feed_publicacoes
  for update to authenticated
  using (autor_id = auth.uid() or public.tem_perfil(array['administrador']))
  with check (autor_id = auth.uid() or public.tem_perfil(array['administrador']));

drop policy if exists "Autor ou administrador removem publicação" on public.feed_publicacoes;
create policy "Autor ou administrador removem publicação" on public.feed_publicacoes
  for delete to authenticated
  using (autor_id = auth.uid() or public.tem_perfil(array['administrador']));

-- Manter atualizado_at
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists feed_publicacoes_atualizado_em on public.feed_publicacoes;
create trigger feed_publicacoes_atualizado_em
  before update on public.feed_publicacoes
  for each row execute function public.tocar_atualizado_em();

-- =====================================================
-- Confirmação
-- =====================================================

-- Recarrega o cache de schema do PostgREST (necessário após mexer em FKs)
notify pgrst, 'reload schema';

select roles, count(*) from public.profiles group by roles order by roles;
