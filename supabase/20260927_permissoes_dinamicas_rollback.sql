-- =====================================================
-- ROLLBACK: 20260927_permissoes_dinamicas.sql
-- =====================================================
-- Desfaz a migração de permissões dinâmicas, devolvendo o banco ao estado
-- anterior. Idempotente: pode rodar mais de uma vez.
--
-- ANTES de rodar, leia as duas ressalvas:
--
-- 1) ESTE ROLLBACK REABRE O FURO DA AGENDA.
--    As policies restauradas abaixo são as de 20260920_melhorias_administrativas.sql:31-33,
--    cujo corpo é `true`:
--
--      create policy "Secretaria e administradores criam agenda" ...
--        for insert to authenticated with check (true);
--
--    O nome diz "Secretaria e administradores"; o corpo diz "qualquer
--    autenticado". Fechar esse furo foi justamente o motivo da migração
--    (docs/permissoes-dinamicas-plano.md, seção 2). Desfazer devolve o buraco.
--    Se o arrependimento é sobre adynamicidade e não sobre segurança, prefira
--    a variante "SEM O FURO" no fim deste arquivo em vez deste corpo.
--
-- 2) ROLLBACK É METADE BANCO, METADE CÓDIGO.
--    Este script sozinho deixa o app inutilizável: o front chama
--    rpc('minhas_permissoes') e o PermissaoGuard barra toda rota com
--    `data.chave`. Sem a função, o conjunto chega vazio e todo mundo é
--    jogado para /home. É preciso também reverter o front — ver a lista de
--    arquivos no bloco "O QUE REVERTER NO FRONT" ao fim.
--
-- O QUE SE PERDE (irreversível):
--   * tudo que o administrador configurou na tela /permissoes
--   * todo o histórico de public.permissoes_auditoria
--   Se a tela já foi usada, exporte antes:
--
--   copy (select * from public.permissoes_roles)      to 'concessoes.csv' csv header;
--   copy (select * from public.permissoes_auditoria)  to 'auditoria.csv' csv header;
--
-- OU, MAIS SIMPLES E MAIS SEGURO: não rode este arquivo. Baixe um dump antes
-- de aplicar a migração e, se precisar voltar, restaure o dump:
--
--   supabase db dump --linked --file antes.sql
-- =====================================================


-- =====================================================
-- 1) Devolve as policies substituídas ao corpo antigo
-- =====================================================
--ESTA PRIMEIRO, antes de derrubar public.pode(). O Postgres recusa dropar uma
-- função que uma policy ainda referencia (dependent objects still exist), e as
-- policies da seção 9 da migração referenciam.
--
-- Agenda: volta ao `true` de 20260920_melhorias_administrativas.sql:31-33.
drop policy if exists "Publicar evento" on public.agenda_igreja;
drop policy if exists "Editar evento" on public.agenda_igreja;
drop policy if exists "Excluir evento" on public.agenda_igreja;

drop policy if exists "Secretaria e administradores criam agenda" on public.agenda_igreja;
create policy "Secretaria e administradores criam agenda" on public.agenda_igreja
  for insert to authenticated with check (true);

drop policy if exists "Secretaria e administradores atualizam agenda" on public.agenda_igreja;
create policy "Secretaria e administradores atualizam agenda" on public.agenda_igreja
  for update to authenticated using (true) with check (true);

drop policy if exists "Secretaria e administradores excluem agenda" on public.agenda_igreja;
create policy "Secretaria e administradores excluem agenda" on public.agenda_igreja
  for delete to authenticated using (true);

-- Feed: o nome da policy não mudou na migração, só o corpo. Volta ao
-- `tem_perfil` de 20260927_permissoes_postagens.sql:44-50.
drop policy if exists "Autor, administrador e pastor removem publicação" on public.feed_publicacoes;
create policy "Autor, administrador e pastor removem publicação" on public.feed_publicacoes
  for delete to authenticated
  using (
    autor_id = auth.uid()
    or public.tem_perfil(array['administrador'])
    or public.tem_perfil(array['pastor'])
  );


-- =====================================================
-- 2) Trigger de auditoria
-- =====================================================
drop trigger if exists permissoes_roles_marca_alteracao on public.permissoes_roles;


-- =====================================================
-- 3) Funções
-- =====================================================
-- Nenhuma delas existia antes da migração, então é drop puro. `cascade` não é
-- usado de propósito: se sobrou dependência, o erro deve aparecer em vez de
-- derrubar junto um objeto que ninguém pediu para remover.
drop function if exists public.marcar_permissao_alterada();
drop function if exists public.revogar_permissao(text, text);
drop function if exists public.conceder_permissao(text, text);
drop function if exists public.minhas_permissoes();
drop function if exists public.pode(text);


-- =====================================================
-- 4) Tabelas
-- =====================================================
-- Os índices (permissoes_roles_role_idx, permissoes_auditoria_feito_em_idx) e
-- as policies de leitura destas tabelas saem junto, por serem dependentes.
--
-- Os `revoke insert, update, delete ... from authenticated` da seção 3 da
-- migração também deixam de existir junto com as tabelas.
--
-- A ordem respeita a FK: permissoes_roles referencia permissoes com
-- on delete cascade, então a ordem realmente não importa aqui — mas deixa
-- explícita.
drop table if exists public.permissoes_auditoria;
drop table if exists public.permissoes_roles;
drop table if exists public.permissoes;

-- `role_em` foi criada em 20260925_role_multiplas_e_feed.sql "por compatibilidade
-- com as policies da agenda", mas as policies da agenda nunca a chamaram (usavam
-- `true`). A migração de permissões dinâmicas também não a tocou, então ela
-- permanece como estava. Não é objeto deste rollback.


-- =====================================================
-- 5) Recarrega o cache do PostgREST
-- =====================================================
-- Sem isso, as funções removidas continuam aparecendo no /rest/v1/rpc e o
-- front ainda acha que `minhas_permissoes` existe.
notify pgrst, 'reload schema';


-- =====================================================
-- 6) O QUE REVERTER NO FRONT
-- =====================================================
-- Não é executável, é a lista do que o git precisa desfazer para o app voltar
-- a funcionar. Nada aqui roda no banco.
--
--   git checkout -- src/app/guards/permissao.guard.ts^        (arquivo novo, git rm)
--   git checkout -- src/app/services/permissao.service.ts
--   git checkout -- src/app/components/permissoes/           (diretório novo)
--   git checkout -- src/app/guards/auth.guard.ts
--   git checkout -- src/app/guards/role.guard.ts             (se o delete não foi commitado)
--   git checkout -- src/app/app.routes.ts
--   git checkout -- src/app/app.ts
--   git checkout -- src/app/services/core.service.ts
--   git checkout -- src/app/services/menu.service.ts
--   git checkout -- src/app/services/supabase.service.ts
--   git checkout -- src/app/components/agenda/
--   git checkout -- src/app/components/feed/
--   git checkout -- src/app/components/home/
--   git checkout -- src/app/components/relatorios-caixa/
--   git checkout -- src/app/components/utils/sidebar/
--   git checkout -- src/app/components/utils/searchbar/
--
-- A ordem prática: o mais seguro é reverter o commit inteiro, em vez de
-- arquivo por arquivo, porque o front e o banco precisam voltar juntos.
--
--   git log --oneline                  # achar o commit da migração
--   git revert <hash>                  # ou git revert <hash>..HEAD se forem vários


-- =====================================================
-- 7) VARIANTE "SEM O FURO" — o que provavelmente você quer
-- =====================================================
-- Se o arrependimento é sobre a parte configurável (a tela /permissoes), e não
-- sobre fechar o furo da agenda, NÃO use o `true` da seção 1. Troque aquele
-- bloco por este, que é o mesmo rolamento com a agenda já trancada por
-- `tem_perfil` — sem tabela, sem função, sem tela:
--
--   drop policy if exists "Publicar evento" on public.agenda_igreja;
--   create policy "Secretaria e administradores criam agenda" on public.agenda_igreja
--     for insert to authenticated
--     with check (public.tem_perfil(array['administrador', 'secretaria']));
--
--   drop policy if exists "Editar evento" on public.agenda_igreja;
--   create policy "Secretaria e administradores atualizam agenda" on public.agenda_igreja
--     for update to authenticated
--     using (public.tem_perfil(array['administrador', 'secretaria']))
--     with check (public.tem_perfil(array['administrador', 'secretaria']));
--
--   drop policy if exists "Excluir evento" on public.agenda_igreja;
--   create policy "Secretaria e administradores excluem agenda" on public.agenda_igreja
--     for delete to authenticated
--     using (public.tem_perfil(array['administrador', 'secretaria']));
--
-- A diferença em relação ao estado pré-migração é o pastor: antes ele não
-- tinha acesso à agenda de escrita (a policy era `true` para todos, e ele
-- também não era menciona do em lugar nenhum). Se quiser o papel do pastor de
-- volta, acrescente 'pastor' aos três arrays. Decisão é da igreja, e por isso
-- fica comentada em vez de assumida.


-- =====================================================
-- 8) Confirmação
-- =====================================================
-- Nenhuma tabela de permissões deve sobrar.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename like 'permissoes%';

-- Nenhuma das funções da migração deve sobrar.
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('pode', 'minhas_permissoes', 'conceder_permissao',
                  'revogar_permissao', 'marcar_permissao_alterada');

-- A agenda deve ter de volta as 4 policies originais.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'agenda_igreja'
order by policyname;

-- O feed deve ter 4 policies: select, insert, update e delete.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'feed_publicacoes'
order by policyname;

-- A lista de furos `true` deve voltar a mostrar a agenda. Se ela voltar
-- VAZIA, o bloco da seção 1 não rodou inteiro — e provavelmente por causa de
-- uma dependência. Reexecutar este arquivo é seguro.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by tablename, policyname;
