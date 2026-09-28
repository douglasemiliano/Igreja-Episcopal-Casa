-- 20260930_celulas.sql
-- ============================================================================
-- Células: cadastro da célula, do líder e dos membros que participam dela.
--
-- O que entra aqui:
--   1) public.celulas          -> a célula em si (nome, quando e onde se reúne)
--   2) public.celula_membros   -> quem participa, e com que papel
--   3) RLS: quem lê, quem gerencia, e a regra do líder da própria célula
--   4) public.minhas_celulas() -> o que o /perfil mostra da célula da pessoa
--   5) as duas chaves novas no catálogo de permissões
--
-- Duas decisões de domínio que vieram do usuário e que mudam o desenho:
--
--   * Uma célula pode ter VÁRIOS líderes. Por isso o líder não é coluna de
--     `celulas`: ele é uma linha de `celula_membros` com papel 'lider'. Se
--     amanhã o líder virar uma coluna, um casal ou um tandem de liderança
--     viram exclusão + inserção.
--
--   * Um membro participa de NO MÁXIMO UMA célula. Isso é um índice único em
--     `celula_membros (membro_id)`, não uma regra de aplicação: o banco
--     recusa, e a interface explica. Consequência que vale registrar: um
--     líder não pode liderar duas células ao mesmo tempo. Para mudar isso
--     depois basta remover o índice `celula_membros_membro_unico`.
-- ============================================================================


-- =====================================================
-- 1) TABELAS
-- =====================================================

create table if not exists public.celulas (
  id         uuid primary key default gen_random_uuid(),
  nome       text    not null,
  descricao  text,
  -- 'dia_semana' é texto livre e não um enum: na prática a igreja escreve
  -- "terças", "quarta e sexta", "sábado de manhã", e um CHECK com dias da
  -- semana obrigaria a cadastrar isso como duas células distintas.
  dia_semana text,
  local      text,
  -- 'time' e não 'text' porque é o que o form entrega, e horário é
  -- ordenável/comparável quando a agenda quiser cruzar com a célula.
  horario    time,
  ativa      boolean not null default true,
  criado_em  timestamptz not null default now()
);

comment on table public.celulas is
  'Células da igreja. O líder é um membro com papel ''lider'' em celula_membros.';

create table if not exists public.celula_membros (
  celula_id uuid not null references public.celulas(id)  on delete cascade,
  membro_id uuid not null references public.membros(id) on delete cascade,
  papel     text    not null default 'membro',
  criado_em timestamptz not null default now(),
  primary key (celula_id, membro_id),
  -- 'membro' e 'lider' são os dois papéis. Não existe papel de reserva aqui: a
  -- distinção que importa para o acesso é "é líder desta célula", e ela já
  -- está em `papel`.
  constraint celula_membros_papel check (papel in ('membro', 'lider'))
);

comment on table public.celula_membros is
  'Quem participa de cada célula. Um membro em no máximo uma célula (índice único em membro_id).';


-- =====================================================
-- 2) INDICES
-- =====================================================

-- Um membro, no máximo, uma célula. É a regra de domínio e mora no banco:
-- sem este índice, duas abas do navegador inserindo em paralelo criam a mesma
-- duplicata que o front tentaria impedir.
create unique index if not exists celula_membros_membro_unico
  on public.celula_membros (membro_id);

-- O detalhe da célula lê os participantes por celula_id; a listagem de
-- células conta membros e líderes por celula_id, então é o mesmo caminho.
create index if not exists celula_membros_celula_idx
  on public.celula_membros (celula_id);

-- A listagem ordena por nome e filtra as ativas.
create index if not exists celulas_nome_idx
  on public.celulas (nome);


-- =====================================================
-- 3) FUNCOES
-- =====================================================
-- VEM ANTES DAS POLICIES, e a ordem não é estética: a policy de
-- `celula_membros` chama `lider_da_celula()`, e o Postgres resolve a função
-- no momento em que a policy é criada, não quando a policy é avaliada. Com a
-- função depois, a migration morre em 42883
-- ("function public.lider_da_celula(uuid) does not exist") bem no meio do
-- arquivo, deixando as tabelas criadas e nenhuma policy de escrita.

-- 3.1) lider_da_celula
-- ---------------------------------------------------------------------------
-- Responde "o usuário logado lidera esta célula?".
--
-- SECURITY DEFINER é obrigatório aqui, e não por conveniência: a policy de
-- `celula_membros` chama esta função, e a função lê `celula_membros`. Se
-- rodasse com os privilégios de quem chamou, a RLS da própria tabela
-- dispararia de novo, dentro da policy, e o Postgres aborta com
-- "infinite recursion detected in policy". Sendo SECURITY DEFINER, a leitura
-- acontece com o dono da tabela, que não é sujeito à RLS dela, e o ciclo
-- some. É o mesmo mecanismo que `public.pode()` usa.
--
-- O caminho é auth.uid() -> membros.user_id -> celula_membros.membro_id, e não
-- auth.uid() direto, porque celula_membros referencia o id do MEBRO e não o
-- da conta.
-- ---------------------------------------------------------------------------
create or replace function public.lider_da_celula(alvo_celula uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.celula_membros cm
      join public.membros m on m.id = cm.membro_id
     where cm.celula_id = alvo_celula
       and cm.papel     = 'lider'
       and m.user_id    = auth.uid()
  );
$$;

-- 3.2) minhas_celulas
-- ---------------------------------------------------------------------------
-- O que o /perfil mostra: em que célula a pessoa participa e com que papel.
--
-- SECURITY DEFININER porque `celula_membros` e `celulas` têm RLS, e a função
-- precisa devolver a célula de quem é o próprio membro sem depender do
-- `using (true)` das policies de leitura — que hoje existe, mas que a regra do
-- projeto é não usar como atalho para dado pessoal.
--
-- Sempre devolve jsonb, nunca null: o front trata "sem célula" como lista
-- vazia, e um null aqui viraria um `null.map()` silencioso.
-- ---------------------------------------------------------------------------
create or replace function public.minhas_celulas()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',    c.id,
               'nome',  c.nome,
               'papel', cm.papel
             )
             order by c.nome
           ),
           '[]'::jsonb
         )
    from public.celula_membros cm
    join public.celulas c on c.id = cm.celula_id
    join public.membros m on m.id = cm.membro_id
   where m.user_id = auth.uid()
     and c.ativa;
$$;


-- =====================================================
-- 4) RLS
-- =====================================================
-- Leitura liberada a autenticados, como agenda e leccionário: a lista de
-- células é pública dentro da igreja, e o /perfil aponta para o detalhe. O
-- que é restrito é a escrita e a formação.
--
-- Toda policy de escrita passa por public.pode(...), então quem decide é o
-- catálogo — a tela /permissoes — e não estas linhas.

alter table public.celulas         enable row level security;
alter table public.celula_membros  enable row level security;

-- --- celulas: leitura ---
drop policy if exists "Autenticados consultam celulas" on public.celulas;
create policy "Autenticados consultam celulas" on public.celulas
  for select to authenticated using (true);

-- --- celulas: escrita ---
drop policy if exists "Quem gerencia celulas insere celulas" on public.celulas;
create policy "Quem gerencia celulas insere celulas" on public.celulas
  for insert to authenticated with check (public.pode('gerenciar_celulas'));

drop policy if exists "Quem gerencia celulas atualiza celulas" on public.celulas;
create policy "Quem gerencia celulas atualiza celulas" on public.celulas
  for update to authenticated
  using      (public.pode('gerenciar_celulas'))
  with check (public.pode('gerenciar_celulas'));

drop policy if exists "Quem gerencia celulas apaga celulas" on public.celulas;
create policy "Quem gerencia celulas apaga celulas" on public.celulas
  for delete to authenticated using (public.pode('gerenciar_celulas'));

-- --- celula_membros: leitura ---
drop policy if exists "Autenticados consultam celula_membros" on public.celula_membros;
create policy "Autenticados consultam celula_membros" on public.celula_membros
  for select to authenticated using (true);

-- --- celula_membros: escrita ---
-- Além da chave, quem é líder da célula pode montar e desmontar a própria
-- célula sem depender de permissão. A chave continua valendo para as demais:
-- secretaria e o pastor mantêm o controle do grupo inteiro.
drop policy if exists "Quem vincula membros insere em celulas" on public.celula_membros;
create policy "Quem vincula membros insere em celulas" on public.celula_membros
  for insert to authenticated
  with check (
    public.pode('vincular_membros_celula')
    or public.lider_da_celula(celula_id)
  );

-- O update existe para promover alguém a líder (e desfazer). Sem ele, a
-- promotion teria de apagar e reinserir a linha.
drop policy if exists "Quem vincula membros atualiza celulas" on public.celula_membros;
create policy "Quem vincula membros atualiza celulas" on public.celula_membros
  for update to authenticated
  using (
    public.pode('vincular_membros_celula')
    or public.lider_da_celula(celula_id)
  )
  with check (
    public.pode('vincular_membros_celula')
    or public.lider_da_celula(celula_id)
  );

drop policy if exists "Quem vincula membros remove de celulas" on public.celula_membros;
create policy "Quem vincula membros remove de celulas" on public.celula_membros
  for delete to authenticated
  using (
    public.pode('vincular_membros_celula')
    or public.lider_da_celula(celula_id)
  );


-- =====================================================
-- 5) PERMISSOES DAS FUNCOES
-- =====================================================
-- `public` e `anon` perdem o execute: sem este revoke, como o PostgreSQL dá
-- EXECUTE para PUBLIC por padrão, um visitante sem sessão poderia chamar
-- `minhas_celulas()` — que devolveria vazio, mas `lider_da_celula()` aceitaria
-- ser sondada com uuid de celula a cada tentativa.

revoke all on function public.lider_da_celula(uuid)  from public, anon;
revoke all on function public.minhas_celulas()       from public, anon;

grant execute on function public.lider_da_celula(uuid) to authenticated;
grant execute on function public.minhas_celulas()      to authenticated;


-- =====================================================
-- 6) CHAVES NO CATALOGO
-- =====================================================
-- Duas chaves, e não uma: quem cria/edita a célula não é automaticamente quem
-- forma o grupo. A secretaria e o pastor querem os dois poderes, mas quem
-- gerencia as células pode não ser quem escolhe os participantes. O admin
-- continua decidindo a combinação em /permissoes.

insert into public.permissoes (chave, rotulo, descricao, categoria, ordenacao, reservada) values
  ('gerenciar_celulas',     'Gerenciar células',     'Criar, editar e excluir células da igreja', 'Comunidade', 52, false),
  ('vincular_membros_celula','Vincular membros à célula','Adicionar, remover e promover membros dentro das células', 'Comunidade', 53, false)
on conflict (chave) do update
  set rotulo    = excluded.rotulo,
      descricao = excluded.descricao,
      categoria = excluded.categoria,
      ordenacao = excluded.ordenacao;

-- `do nothing`: reexecutar a migration não pode tirar uma concessão que o
-- administrador tenha ajustado na tela depois.
insert into public.permissoes_roles (chave, role) values
  ('gerenciar_celulas',      'administrador'),
  ('gerenciar_celulas',      'pastor'),
  ('gerenciar_celulas',      'secretaria'),
  ('vincular_membros_celula', 'administrador'),
  ('vincular_membros_celula', 'pastor'),
  ('vincular_membros_celula', 'secretaria')
on conflict do nothing;

-- O papel 'membro' NÃO recebe nenhuma das duas. Ele enxerga a lista de
-- células (item de menu sem chave) e a própria célula no /perfil, que é o que
-- a pessoa precisa para saber onde e quando se encontra. Formation de célula é
-- decisão de liderança.


-- =====================================================
-- 7) CHECAGEM
-- =====================================================
-- Rode depois de aplicar. Todas as consultas são de leitura.

-- 7.1) As duas tabelas existem e com RLS ligado?
select
  c.relname            as tabela,
  c.relrowsecurity     as rls_ativo,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('celulas', 'celula_membros')
 order by c.relname;
-- esperado: 2 linhas, rls_ativo = true, celulas = 4 policies,
--            celula_membros = 4 policies

-- 7.2) As chaves novos estão semeadas?
select chave, rotulo, categoria
  from public.permissoes
 where chave in ('gerenciar_celulas', 'vincular_membros_celula')
 order by chave;
-- esperado: 2 linhas

-- 7.3) Quem recebeu as chaves?
select chave, role
  from public.permissoes_roles
 where chave in ('gerenciar_celulas', 'vincular_membros_celula')
 order by chave, role;
-- esperado: administrador, pastor e secretaria em cada uma

-- 7.4) As funções existem e o autenticado pode chamá-las?
select p.proname,
       p.prosecdef   as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as autenticado_executa
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('lider_da_celula', 'minhas_celulas')
 order by p.proname;
-- esperado: 2 linhas, security_definer = true, autenticado_executa = true

-- 7.5) O índice de uma célula por membro está de pé?
--       Sem ele, a regra "um membro, uma célula" é só sugestão.
select indexname
  from pg_indexes
 where schemaname = 'public'
   and indexname = 'celula_membros_membro_unico';
-- esperado: 1 linha. Se vier vazio, o índice não foi criado e a regra não
-- existe.
