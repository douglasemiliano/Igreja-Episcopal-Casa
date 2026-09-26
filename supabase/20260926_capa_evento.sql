-- =====================================================
-- Foto na criação de evento (agenda_igreja)
--
-- Coluna imagem_url em agenda_igreja. A foto vai para o bucket 'postagens',
-- o mesmo do feed, dentro da pasta de quem enviou.
--
-- Reaproveitar o bucket economiza mais um bucket público para governar e
-- mantém uma única regra de leitura. A pasta do usuário é a mesma, o que
-- faz 'evento-<aleatorio>.jpg' conviver com a foto do feed sem conflito:
-- os nomes ALEATÓRIOS garantem que um nunca sobrescreve o outro.
--
-- A coluna é nullable: evento sem foto continua válido.
-- Este script é idempotente.
-- =====================================================

-- 1) Coluna da foto
alter table public.agenda_igreja
  add column if not exists imagem_url text;

-- Só https do próprio projeto; evita injetar javascript: ou data: no <img>
alter table public.agenda_igreja
  drop constraint if exists agenda_igreja_imagem_url_check;
alter table public.agenda_igreja
  add constraint agenda_igreja_imagem_url_check
  check (
    imagem_url is null
    or imagem_url ~ '^https://[^/]+/storage/v1/object/public/postagens/'
  );

-- 2) Bucket. Já existe pelo script do feed; este insert cobre o caso de este
--    script rodar antes. O on conflict só toca 'public', preservando o
--    file_size_limit já configurado.
insert into storage.buckets (id, name, public)
values ('postagens', 'postagens', true)
on conflict (id) do update set public = true;

-- 3) Policies do bucket. Repetidas aqui (idempotentes) para que este script
--    funcione sozinho, sem depender da ordem em que os migrations rodaram.
drop policy if exists "Fotos do feed são lidas por autenticados" on storage.objects;
create policy "Fotos do feed são lidas por autenticados" on storage.objects
  for select to authenticated
  using (bucket_id = 'postagens');

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

-- 4) Limite por arquivo. O cliente compacta para 1280px antes de enviar,
--    então o limite cobre só o arquivo já reduzido.
update storage.buckets
set file_size_limit = 3145728  -- 3 MB
where id = 'postagens';

-- 5) Confirmação
notify pgrst, 'reload schema';

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'agenda_igreja'
order by ordinal_position;
