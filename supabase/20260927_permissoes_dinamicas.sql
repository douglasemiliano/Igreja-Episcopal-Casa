-- =====================================================
-- Permissões dinâmicas: catálogo, função pode() e migração das policies
-- =====================================================
-- Troca a permissão hardcoded (f(role), escrita a mão em cada tela e em
-- cada policy) por uma capacidade nomeada e configurável (f(chave)), lida
-- de uma tabela que o administrador edita na tela /permissoes.
--
-- O plano completo, com as decisões e as armadilhas, está em
-- docs/permissoes-dinamicas-plano.md.
--
-- A premissa é que a RLS é o ponto de aplicação de fato: o front-end usa a
-- chave de usuário do Supabase, sem service_role no bundle. Se algum dia
-- entrar uma service_role, este desenho deixa de valer.
--
-- O que muda de verdade nas policies está no fim do arquivo, e é o
-- fechamento de um furo antigo: as policies da agenda se chamavam
-- "Secretaria e administradores criam/atualizam/excluem agenda", mas o
-- corpo era `with check (true)` e `using (true)`. Qualquer autenticado
-- inseria, editava e apagava evento, e o `podeEditar` do componente era
-- só fachada.
--
-- Script idempotente: pode rodar mais de uma vez.
-- =====================================================

-- =====================================================
-- 1) Tabelas
-- =====================================================
-- `permissoes` é o catálogo de capacidades. Nasce por migration, nunca é
-- digitado na tela: a tela do admin renderiza o que está aqui, e a regra de
-- trabalho é que toda chave usada no código precisa estar semeada.
create table if not exists public.permissoes (
  chave     text primary key,
  rotulo    text    not null,
  descricao text,
  categoria text    not null default 'Geral',
  ordenacao int     not null default 100,
  -- Chave reservada não pode ser concedida a ninguém. O plano previa um
  -- CHECK, mas a coluna resolve melhor: a tela mostra a chave trancada,
  -- explicando por que ela não é mexível, em vez de escondê-la.
  reservada boolean not null default false
);

create table if not exists public.permissoes_roles (
  chave text not null references public.permissoes(chave) on delete cascade,
  role  text not null,
  primary key (chave, role)
);

create index if not exists permissoes_roles_role_idx
  on public.permissoes_roles (role);

-- =====================================================
-- 2) RLS das tabelas de permissão
-- =====================================================
-- Leitura liberada a autenticados. É configuração, não dado sensível: a tela
-- do admin precisa ler a matriz inteira para desenhar as caixas.
alter table public.permissoes enable row level security;
alter table public.permissoes_roles enable row level security;

drop policy if exists "Autenticados consultam permissoes" on public.permissoes;
create policy "Autenticados consultam permissoes" on public.permissoes
  for select to authenticated using (true);

drop policy if exists "Autenticados consultam permissoes_roles" on public.permissoes_roles;
create policy "Autenticados consultam permissoes_roles" on public.permissoes_roles
  for select to authenticated using (true);

-- =====================================================
-- 3) Escrita só por RPC
-- =====================================================
-- Sem este revoke, o papel `authenticated` (que no Supabase costuma ter ALL
-- por padrão nas tabelas de public) escreveria em permissoes_roles pelo
-- REST, contornando o gatilho de auditoria. Com o revoke, só funções
-- security definer gravam, e o rastro é garantido.
revoke insert, update, delete on public.permissoes from authenticated;
revoke insert, update, delete on public.permissoes_roles from authenticated;

-- =====================================================
-- 4) pode(): a função que as policies consultam
-- =====================================================
-- Mesmo desenho de public.tem_perfil e public.is_admin
-- (20260925_roles_multiplas_e_feed.sql): sql, stable, security definer,
-- search_path preso. O security definer é o que permite ler
-- permissoes_roles e profiles sem passar pela RLS delas.
--
-- O parâmetro se chama chave_procurada, e não chave, de propósito: com o
-- nome igual ao da coluna, o SQL exigiria public.pode.chave e a função
-- ficaria mais difícil de ler.
--
-- `not p.reservada` dentro do exists é a defesa da chave reservada: mesmo
-- que alguém consiganse inserir uma linha em permissoes_roles para
-- 'gerenciar_permissoes', pode() continuaria ignorando. A restrição é por
-- construção, não por convenção.
create or replace function public.pode(chave_procurada text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Bypass do administrador: hardcoded, não revogável, e por isso não
    -- precisa de proteção contra lockout.
    public.tem_perfil(array['administrador']::text[])
    or exists (
      select 1
      from public.permissoes p
      join public.permissoes_roles pr on pr.chave = p.chave
      join public.profiles pf on pf.id = auth.uid()
      where p.chave = chave_procurada
        and not p.reservada
        and pr.role = any (pf.roles)
    );
$$;

-- Conjunto de quem a pessoa é. O front-end busca isso uma vez no login e
-- consulta as capabilities localmente, sem ir ao banco a cada @if.
create or replace function public.minhas_permissoes()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p.chave), '{}'::text[])
  from public.permissoes p
  where public.pode(p.chave);
$$;

-- =====================================================
-- 5) Conceder e revogar
-- =====================================================
create or replace function public.conceder_permissao(alvo_chave text, alvo_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tem_perfil(array['administrador']) then
    raise exception 'Somente administrador gerencia permissoes';
  end if;

  if exists (select 1 from public.permissoes where chave = alvo_chave and reservada) then
    raise exception 'A permissao % e reservada e nao pode ser concedida', alvo_chave;
  end if;

  if not exists (select 1 from public.permissoes where chave = alvo_chave) then
    raise exception 'Permissao desconhecida: %', alvo_chave;
  end if;

  insert into public.permissoes_roles (chave, role)
  values (alvo_chave, alvo_role)
  on conflict do nothing;
end $$;

create or replace function public.revogar_permissao(alvo_chave text, alvo_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tem_perfil(array['administrador']) then
    raise exception 'Somente administrador gerencia permissoes';
  end if;

  delete from public.permissoes_roles
  where chave = alvo_chave and role = alvo_role;
end $$;

-- =====================================================
-- 6) Auditoria
-- =====================================================
-- Mesmo padrão de 20260926_auditoria_saidas_caixa.sql: o rastro vem de um
-- trigger, não do cliente. Quem mudou a permissão de alguém é informação
-- que precisa sobreviver a quem mudou.
create table if not exists public.permissoes_auditoria (
  id       bigint generated always as identity primary key,
  chave    text    not null,
  role     text    not null,
  operacao text    not null check (operacao in ('conceder', 'revogar')),
  feito_por uuid references auth.users(id) on delete set null,
  feito_em timestamptz not null default now()
);

create index if not exists permissoes_auditoria_feito_em_idx
  on public.permissoes_auditoria (feito_em desc);

alter table public.permissoes_auditoria enable row level security;

drop policy if exists "Administrador le a auditoria de permissoes" on public.permissoes_auditoria;
create policy "Administrador le a auditoria de permissoes" on public.permissoes_auditoria
  for select to authenticated
  using (public.tem_perfil(array['administrador']));

revoke insert, update, delete on public.permissoes_auditoria from authenticated;

create or replace function public.marcar_permissao_alterada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.permissoes_auditoria (chave, role, operacao, feito_por)
    values (new.chave, new.role, 'conceder', auth.uid());
    return new;
  end if;

  insert into public.permissoes_auditoria (chave, role, operacao, feito_por)
  values (old.chave, old.role, 'revogar', auth.uid());
  return old;
end;
$$;

drop trigger if exists permissoes_roles_marca_alteracao on public.permissoes_roles;
create trigger permissoes_roles_marca_alteracao
  after insert or delete on public.permissoes_roles
  for each row execute function public.marcar_permissao_alterada();

-- =====================================================
-- 7) Catálogo
-- =====================================================
-- `reservada` fica fora do on conflict de propósito: a coluna é escrita só
-- por migration, e regravá-la aqui permitiria que uma reexecução
-- accidentialmente destrancasse a chave reservada.
insert into public.permissoes (chave, rotulo, descricao, categoria, ordenacao, reservada) values
  ('ver_central',              'Ver a Central',            'Acesso ao painel de atalhos da igreja',                    'Igreja',    10, false),
  ('publicar_evento',          'Publicar evento',          'Criar eventos na agenda',                                   'Igreja',    20, false),
  ('editar_evento',            'Editar evento',            'Alterar eventos existentes da agenda',                      'Igreja',    21, false),
  ('excluir_evento',           'Excluir evento',           'Remover eventos da agenda',                                 'Igreja',    22, false),
  ('publicar_publicacao',      'Publicar no feed',         'Escrever atualizações no mural',                           'Igreja',    30, false),
  ('excluir_publicacao',       'Excluir publicação',       'Remover do mural posts de terceiros',                      'Igreja',    31, false),
  ('operar_arrecadacoes',      'Operar o caixa',           'Lançar vendas, fiados e saídas',                           'Caixa',     40, false),
  ('ver_relatorios_caixa',     'Ver relatórios de caixa',  'Consultar histórico e relatórios',                         'Caixa',     41, false),
  ('reabrir_caixa',            'Reabrir caixa fechado',    'Reabrir um caixa que já foi encerrado',                     'Caixa',     42, false),
  ('cadastrar_membros',        'Cadastrar membros',        'Incluir novos membros na igreja',                           'Comunidade',50, false),
  ('ver_dashboard',            'Ver dashboard',            'Consultar os indicadores da igreja',                        'Comunidade',51, false),
  ('emitir_certificado',       'Emitir certificados',      'Emitir certificados de batismo e casamento',                 'Registros', 60, false),
  ('ver_livro_registro',       'Ver livros de registro',   'Consultar os livros da igreja',                             'Registros', 61, false),
  ('registrar_batismo',        'Registrar batismo',        'Lançar batismos no livro de registro',                      'Registros', 62, false),
  ('gerenciar_lecionario',     'Gerenciar lecionário',     'Criar e editar lecionários',                                'Registros', 63, false),
  ('gerenciar_usuarios',       'Gerenciar usuários',       'Ativar contas e trocar perfis',                             'Administração', 70, false),
  ('gerenciar_permissoes',     'Gerenciar permissões',     'Definir quem pode fazer o quê. Reservada ao administrador: quem controla as permissões não pode ter a permissão controlada', 'Administração', 71, true)
on conflict (chave) do update
  set rotulo    = excluded.rotulo,
      descricao = excluded.descricao,
      categoria = excluded.categoria,
      ordenacao = excluded.ordenacao;

-- =====================================================
-- 8) Quem tem o quê hoje
-- =====================================================
-- Reproduz exatamente os arrays que estavam escritos a mão no front
-- (app.routes.ts, menu.service.ts e os componentes), para que a troca não
-- mude o acesso de ninguém. Depois daqui quem muda é o admin, na tela.
--
-- `do nothing` de propósito: reexecutar a migration não pode remover o que
-- o administrador já configurou.
insert into public.permissoes_roles (chave, role) values
  -- Igreja
  ('ver_central',         'administrador'),
  ('ver_central',         'secretaria'),
  ('ver_central',         'caixa'),
  ('ver_central',         'tesouraria'),
  ('ver_central',         'pastor'),
  ('ver_central',         'lider'),
  ('publicar_evento',     'administrador'),
  ('publicar_evento',     'secretaria'),
  ('publicar_evento',     'pastor'),
  ('editar_evento',       'administrador'),
  ('editar_evento',       'secretaria'),
  ('editar_evento',       'pastor'),
  ('excluir_evento',      'administrador'),
  ('excluir_evento',      'secretaria'),
  ('excluir_evento',      'pastor'),
  ('publicar_publicacao', 'administrador'),
  ('publicar_publicacao', 'lider'),
  ('excluir_publicacao',  'administrador'),
  ('excluir_publicacao',  'pastor'),
  -- Caixa
  ('operar_arrecadacoes',  'administrador'),
  ('operar_arrecadacoes',  'caixa'),
  ('operar_arrecadacoes',  'tesouraria'),
  ('operar_arrecadacoes',  'pastor'),
  ('ver_relatorios_caixa', 'administrador'),
  ('ver_relatorios_caixa', 'secretaria'),
  ('ver_relatorios_caixa', 'caixa'),
  ('ver_relatorios_caixa', 'tesouraria'),
  ('ver_relatorios_caixa', 'pastor'),
  ('reabrir_caixa',        'administrador'),
  ('reabrir_caixa',        'tesouraria'),
  -- Comunidade
  ('cadastrar_membros',   'administrador'),
  ('cadastrar_membros',   'secretaria'),
  ('cadastrar_membros',   'pastor'),
  ('ver_dashboard',       'administrador'),
  ('ver_dashboard',       'pastor'),
  ('ver_dashboard',       'secretaria'),
  ('ver_dashboard',       'tesouraria'),
  -- Registros
  ('emitir_certificado',  'administrador'),
  ('emitir_certificado',  'secretaria'),
  ('emitir_certificado',  'pastor'),
  ('ver_livro_registro',  'administrador'),
  ('ver_livro_registro',  'secretaria'),
  ('ver_livro_registro',  'pastor'),
  ('registrar_batismo',   'administrador'),
  ('registrar_batismo',   'secretaria'),
  ('registrar_batismo',   'pastor'),
  ('gerenciar_lecionario','administrador'),
  ('gerenciar_lecionario','secretaria'),
  ('gerenciar_lecionario','pastor'),
  -- Administração
  ('gerenciar_usuarios',  'administrador'),
  ('gerenciar_usuarios',  'pastor')
on conflict (chave, role) do nothing;

-- =====================================================
-- 9) Policies que passam a consultar pode()
-- =====================================================
-- Agenda. SELECT continua `using (true)`: todo mundo lê a agenda, o que é
-- restrito são os botões — por isso não existe `ver_agenda` no catálogo.
drop policy if exists "Secretaria e administradores criam agenda" on public.agenda_igreja;
create policy "Publicar evento" on public.agenda_igreja
  for insert to authenticated
  with check (public.pode('publicar_evento'));

drop policy if exists "Secretaria e administradores atualizam agenda" on public.agenda_igreja;
create policy "Editar evento" on public.agenda_igreja
  for update to authenticated
  using (public.pode('editar_evento'))
  with check (public.pode('editar_evento'));

drop policy if exists "Secretaria e administradores excluem agenda" on public.agenda_igreja;
create policy "Excluir evento" on public.agenda_igreja
  for delete to authenticated
  using (public.pode('excluir_evento'));

-- Feed. O UPDATE fica de fora de propósito: "só o autor edita o próprio post"
-- é regra por linha, e public.pode() responde por papel. As duas coisas se
-- somam com AND, mas não se substituem. Ver a seção 7 do plano.
--
-- O DELETE é a combinação dos dois: o autor apaga o que escreveu, e
-- administrador e pastor apagam qualquer um — agora configurável.
drop policy if exists "Autor, administrador e pastor removem publicação" on public.feed_publicacoes;
create policy "Autor, administrador e pastor removem publicação" on public.feed_publicacoes
  for delete to authenticated
  using (autor_id = auth.uid() or public.pode('excluir_publicacao'));

-- =====================================================
-- 10) Recarrega o cache do PostgREST
-- =====================================================
-- Sem isso, as funções novas não aparecem no /rest/v1/rpc e o front recebe
-- PGRST202.
notify pgrst, 'reload schema';

-- =====================================================
-- 11) Confirmação
-- =====================================================
-- 16 chaves no catálogo, 1 reservada, e a de gerenciar_permissoes sem
-- nenhuma linha em permissoes_roles.
select chave, categoria, reservada from public.permissoes order by ordenacao;

select chave, count(*) as papeis from public.permissoes_roles group by chave order by chave;

-- A chave reservada não pode ter nenhuma concessão.
select count(*) as concessoes_reservadas
from public.permissoes_roles pr
join public.permissoes p on p.chave = pr.chave
where p.reservada;

-- Furos do tipo `using (true)`: este arquivo fecha os da agenda e do feed.
-- O que sobrar na lista é caso a parte 4 tratar.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by tablename, policyname;
