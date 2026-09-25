-- =====================================================
-- Avatar do usuário: bucket 'avatars' no Supabase Storage
-- Pasta por usuário: avatars/<user_id>/<arquivo>
-- =====================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Leitura: qualquer autenticado (avatar aparece no header e no mural)
drop policy if exists "Avatars são lidos por autenticados" on storage.objects;
create policy "Avatars são lidos por autenticados" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

-- Upload: apenas o próprio usuário, dentro da própria pasta
drop policy if exists "Usuário sobe seu próprio avatar" on storage.objects;
create policy "Usuário sobe seu próprio avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário altera seu próprio avatar" on storage.objects;
create policy "Usuário altera seu próprio avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário remove seu próprio avatar" on storage.objects;
create policy "Usuário remove seu próprio avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Limite: avatar é uma imagem pequena
update storage.buckets
set file_size_limit = 2097152  -- 2 MB
where id = 'avatars';

-- =====================================================
-- Usuário edita o próprio nome
-- A policy de update em `profiles` só abre para admin/pastor,
-- então o próprio usuário grava por uma função security definer.
-- =====================================================
create or replace function public.atualizar_meu_nome(novo_nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if novo_nome is null or char_length(trim(novo_nome)) < 2 then
    raise exception 'Nome inválido';
  end if;

  update public.profiles
  set nome = trim(novo_nome),
      atualizado_em = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.atualizar_meu_nome(text) from public;
grant execute on function public.atualizar_meu_nome(text) to authenticated;

-- =====================================================
-- Avatar em `profiles.foto`
-- O mural e as listas leem o autor via join em profiles, e a metadata
-- do auth não é acessível nesse join. Então a URL também fica em profiles.
-- =====================================================
alter table public.profiles add column if not exists foto text;

-- Preenche quem já tinha avatar salvo na metadata
update public.profiles p
set foto = u.raw_user_meta_data->>'avatar_url'
from auth.users u
where p.id = u.id
  and p.foto is null
  and u.raw_user_meta_data ? 'avatar_url';

create or replace function public.atualizar_meu_foto(nova_foto text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set foto = nova_foto,
      atualizado_em = now()
  where id = auth.uid();
$$;

revoke all on function public.atualizar_meu_foto(text) from public;
grant execute on function public.atualizar_meu_foto(text) to authenticated;

notify pgrst, 'reload schema';
