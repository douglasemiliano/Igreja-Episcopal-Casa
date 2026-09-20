create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'leitor' check (role in ('administrador', 'secretaria', 'caixa', 'leitor')),
  nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.agenda_igreja (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text not null check (tipo in ('culto', 'reuniao', 'batismo', 'casamento', 'arrecadacao', 'escala', 'outro')),
  inicio timestamptz not null,
  fim timestamptz,
  local text,
  responsaveis text,
  observacoes text,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.registros_batismo
  add column if not exists membro_id uuid references public.membros(id) on delete set null;

alter table public.profiles enable row level security;
alter table public.agenda_igreja enable row level security;

create policy "Usuários autenticados consultam perfis" on public.profiles for select to authenticated using (true);
create policy "Usuários autenticados consultam agenda" on public.agenda_igreja for select to authenticated using (true);
create policy "Secretaria e administradores criam agenda" on public.agenda_igreja for insert to authenticated with check (true);
create policy "Secretaria e administradores atualizam agenda" on public.agenda_igreja for update to authenticated using (true) with check (true);
create policy "Secretaria e administradores excluem agenda" on public.agenda_igreja for delete to authenticated using (true);