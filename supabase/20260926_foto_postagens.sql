-- =====================================================
-- Foto na publicação do feed
--
-- Coluna imagem_url em feed_publicacoes + bucket 'postagens'.
-- Pasta por usuário: postagens/<user_id>/<arquivo>
--
-- A coluna é nullable: publicação só de texto continua válida.
-- Este script é idempotente.
-- =====================================================

-- 1) Coluna da foto na publicação
alter table public.feed_publicacoes
  add column if not exists imagem_url text;

-- Só https do próprio projeto; evita injetar javascript: ou data: no <img>
alter table public.feed_publicacoes
  drop constraint if exists feed_publicacoes_imagem_url_check;
alter table public.feed_publicacoes
  add constraint feed_publicacoes_imagem_url_check
  check (
    imagem_url is null
    or imagem_url ~ '^https://[^/]+/storage/v1/object/public/postagens/'
  );

-- 2) Bucket
insert into storage.buckets (id, name, public)
values ('postagens', 'postagens', true)
on conflict (id) do update set public = true;

-- 3) Leitura: o feed é visto por todos os autenticados
drop policy if exists "Fotos do feed são lidas por autenticados" on storage.objects;
create policy "Fotos do feed são lidas por autenticados" on storage.objects
  for select to authenticated
  using (bucket_id = 'postagens');

-- 4) Escrita: só o próprio usuário, dentro da própria pasta
drop policy if exists "Usuário sobe foto da própria publicação" on storage.objects;
create policy "Usuário sobe foto da própria publicação" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'postagens'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário altera foto da própria publicação" on storage.objects;
create policy "Usuário altera foto da própria publicação" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'postagens'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'postagens'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário remove foto da própria publicação" on storage.objects;
create policy "Usuário remove foto da própria publicação" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'postagens'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5) Limite por arquivo. O cliente compacta para 1280px antes de enviar,
--    então o limite cobre só o arquivo já reduzido.
update storage.buckets
set file_size_limit = 3145728  -- 3 MB
where id = 'postagens';

-- 6) Confirmação
notify pgrst, 'reload schema';

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'feed_publicacoes'
order by ordinal_position;
