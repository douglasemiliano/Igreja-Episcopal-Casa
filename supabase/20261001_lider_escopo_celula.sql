-- 20261001_lider_escopo_celula.sql
-- ============================================================================
-- O líder de célula forma a PRÓPRIA célula. Só quem é da direção forma qualquer
-- uma.
--
-- O que já estava pronto (20260930_celulas.sql):
--
--   * A policy de `celula_membros` já aceitou `pode('vincular_membros_celula')
--     or lider_da_celula(celula_id)`. Então o líder JÁ conseguia adicionar
--     pessoas na célula dele, e a tela em detalhe-celula.component.ts já
--     mostrava o botão. Nenhuma dessas partes muda aqui.
--
-- O buraco que esta migration fecha é o "or":
--
--   `pode('vincular_membros_celula')` é uma chave GLOBAL, e a tela /permissoes
--   deixa o administrador marcar qualquer papel nela — inclusive `lider` e
--   `membro`. No dia em que alguém marcare, todo líder da igreja passa a poder
--   entrar em qualquer célula, e a regra "o líder só mexe na própria" deixa de
--   existir sem ninguém ter decidido isso. O botão de mentira que a seção 2 de
--   docs/permissoes-dinamicas-plano.md advertiu, agora com a chave de célula.
--
-- A correção não é fechar a chave — o catálogo é para o administrador
-- decidir. É separar as duas coisas que a chave misturava:
--
--   * FORMAR A PRÓPRIA CÉLULA   -> quem lidera aquela célula. Vem da
--     participação da pessoa, não do catálogo. Não é concessão e não revoga.
--   * FORMAR QUALQUER CÉLULA    -> chave `vincular_membros_celula` E um papel
--     de direção. É isto aqui que a lista de papéis abaixo nomeia.
--
-- E para o "líder só na própria célula" continuar valendo depois desta
-- migration, a segunda metade não pode depender do catálogo: ela é a lista
-- escrita em public.pode_formar_qualquer_celula(), e conceder a chave a
-- `lider` pela tela não passa a valer em nenhuma célula.
--
-- DECISÃO DE DOMÍNIO QUE VEIO DO USUÁRIO: quem pode adicionar em todas as
-- células é administrador, pastor e secretaria. O `lider` e o `membro` não
-- entram na lista de direção — o `lider` forma a célula que ele lidera, e
-- nada mais.
--
-- O que NÃO muda aqui:
--
--   * `gerenciar_celulas` (criar, editar, excluir a célula) continua só para
--     quem o catálogo disser. O líder monta o grupo da própria célula, mas não
--     edita o cadastro dela.
--   * O INSERT em `membros` continua exigindo `cadastrar_membros`. O líder
--     vincula pessoas que JÁ são membros da igreja; ele não cria cadastro
--     novo. Se um dia ele puder, é outra chave e outra policy.
--
-- Idempotente. Pode rodar mais de uma vez.
-- ============================================================================


-- =====================================================
-- 1) PAPEIS QUE FORMAM QUALQUER CÉLULA
-- =====================================================
-- Lista escrita à mão de propósito, e é o ponto inteiro desta migration:
-- ela é a trava contra a escalada via /permissoes. Se a chave
-- `vincular_membros_celula` for concedida ao papel `lider` na tela, o líder
-- continua sem poder formar célula nenhuma que não seja a sua.
--
-- `administrador` aqui é redundante para quem já tem a chave (o bypass de
-- public.pode() cobre o administrador), mas fica nomeado porque a lista é
-- sobre papel, e a tela de /permissoes também mostra o administrador como
-- única coluna fixa.

create or replace function public.papeis_que_formam_qualquer_celula()
returns text[]
language sql
stable
as $$
  select array['administrador','pastor','secretaria']::text[];
$$;

comment on function public.papeis_que_formam_qualquer_celula() is
  'Papeis que podem formar o grupo de QUALQUER celula, alem de liderarem a propria.';


-- =====================================================
-- 2) AS DUAS FUNCOES DA REGRA
-- =====================================================
-- VEM ANTES DAS POLICIES, e a ordem não é estética: as policies de
-- `celula_membros` chamam `pode_vincular_esta_celula()`, e o Postgres resolve
-- a função no momento em que a policy é criada, não quando ela é avaliada.
-- Com a função depois, a migration morre em 42883 no meio do arquivo,
-- deixando as policies antigas — que são a regra antiga — no lugar.

-- 2.1) pode_formar_qualquer_celula
-- ---------------------------------------------------------------------------
-- A metade "global": tem a chave E é papel de direção.
--
-- Existe como função separada, e não embutida em pode_vincular_esta_celula(),
-- por dois motivos: a metade "global" fica nomeada e auditável sozinha, e as
-- policies novas leem uma regra só, escrita por extenso. Uma regra repetida em
-- três policies é uma regra que alguém corrige em duas.
-- ---------------------------------------------------------------------------
create or replace function public.pode_formar_qualquer_celula()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode('vincular_membros_celula')
     and public.tem_perfil(public.papeis_que_formam_qualquer_celula());
$$;

comment on function public.pode_formar_qualquer_celula() is
  'Tem vincular_membros_celula e e papel de direcao: forma o grupo de qualquer celula.';


-- 2.2) pode_vincular_esta_celula
-- ---------------------------------------------------------------------------
-- A regra completa, já com a célula como argumento: "esta pessoa pode mexer
-- no grupo DESTA célula?".
--
-- SECURITY DEFINER pelo mesmo motivo de public.lider_da_celula(): esta função
-- é chamada de dentro da policy de `celula_membros` e ela lê `celula_membros`.
-- Rodando com os privilégios de quem chamou, a RLS da própria tabela
-- dispararia de novo dentro da policy e o Postgres aborta com "infinite
-- recursion detected in policy".
--
-- `lider_da_celula` volta a ser chamada daqui em vez de ser repetida nas três
-- policies. Uma regra escrita em três lugares é uma regra que alguém corrige em
-- dois.
-- ---------------------------------------------------------------------------
create or replace function public.pode_vincular_esta_celula(alvo_celula uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.lider_da_celula(alvo_celula)
      or public.pode_formar_qualquer_celula();
$$;

comment on function public.pode_vincular_esta_celula(uuid) is
  'Verdadeiro para quem lidera a celula informada ou para quem pode formar qualquer celula.';


-- =====================================================
-- 3) POLICIES DE celula_membros
-- =====================================================
-- As três policies de escrita passam a chamar a função. O nome delas muda
-- porque o texto dentro mudou: "Quem vincula membros" dizia que qualquer
-- chave podia, e agora quem vincula é quem lidia com a célula. Um nome de
-- policy aparece no erro que o PostgREST devolve, então ele precisa parar de
-- mentir junto com a regra.

-- --- INSERT: colocar alguém no grupo ---
drop policy if exists "Quem vincula membros insere em celulas" on public.celula_membros;
create policy "Quem forma a celula insere membros" on public.celula_membros
  for insert to authenticated
  with check (public.pode_vincular_esta_celula(celula_id));

-- --- UPDATE: promover a líder, ou devolver o papel ---
-- O update existe para a promoção. Sem ele, promover seria apagar e reinserir
-- a linha, e apagar também é política do mesmo conjunto.
drop policy if exists "Quem vincula membros atualiza celulas" on public.celula_membros;
create policy "Quem forma a celula promove membros" on public.celula_membros
  for update to authenticated
  using      (public.pode_vincular_esta_celula(celula_id))
  with check (public.pode_vincular_esta_celula(celula_id));

-- --- DELETE: tirar alguém do grupo ---
-- A pessoa continua membro da igreja. Isto não exclui ninguém de `membros`.
drop policy if exists "Quem vincula membros remove de celulas" on public.celula_membros;
create policy "Quem forma a celula remove membros" on public.celula_membros
  for delete to authenticated
  using (public.pode_vincular_esta_celula(celula_id));


-- =====================================================
-- 4) CONCESSOES QUE VIRARAM ESCALADA
-- =====================================================
-- Limpagem do que já foi concedido errado. Não é prevenção: se alguém já
-- marcou `vincular_membros_celula` para `lider` na tela /permissoes, a linha
-- continua na tabela e public.pode() continua devolvendo true — só que
-- pode_vincular_esta_celula() já não a respeita. A linha é removida para a
-- matriz da tela parar de mostrar uma concessão que não faz nada, e para
-- public.pode_formar_qualquer_celula() não depender dela.
--
-- A auditoria registra essas remoções? Não: esta não é uma revogação pela tela, e a
-- tabela de auditoria é o registro de decisão de quem administra. O que a
-- migration fez está no git.
delete from public.permissoes_roles
 where chave = 'vincular_membros_celula'
   and role in ('lider', 'membro');

-- A descrição do catálogo passa a dizer a verdade, porque a tela de /permissoes
-- mostra este texto ao lado da caixa que o administrador vai marcar.
update public.permissoes
   set descricao = 'Adicionar, remover e promover membros em qualquer célula. O líder de célula não precisa desta chave: ele forma o grupo da célula que ele lidera.'
 where chave = 'vincular_membros_celula';


-- =====================================================
-- 5) PERMISSOES DAS FUNCOES
-- =====================================================
-- `papeis_que_formam_qualquer_celula()` é uma lista constante, sem dado de
-- ninguém. Ela ainda assim fica atrás de execute para authenticated, e não
-- para public: padrão do Postgres é EXECUTE liberado, e nenhuma função nova
-- entra sem revoke explícito, mesmo as inofensivas.
revoke all on function public.papeis_que_formam_qualquer_celula() from public, anon;
revoke all on function public.pode_formar_qualquer_celula()        from public, anon;
revoke all on function public.pode_vincular_esta_celula(uuid)       from public, anon;

grant execute on function public.papeis_que_formam_qualquer_celula() to authenticated;
grant execute on function public.pode_formar_qualquer_celula()        to authenticated;
grant execute on function public.pode_vincular_esta_celula(uuid)       to authenticated;


-- =====================================================
-- 6) RECARREGA O CACHE DO PostgREST
-- =====================================================
-- Sem isto, a API responde PGRST202 "could not find the function" até o
-- cache do PostgREST expire sozinho.
notify pgrst, 'reload schema';


-- =====================================================
-- 7) CHECAGEM
-- =====================================================
-- Rode depois de aplicar.

-- 7.1) As três funções novas existem, são security definer (menos a lista de
--       papéis, que é só uma constante) e o autenticado pode chamá-las?
select p.proname,
       p.prosecdef   as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as autenticado_executa
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('papeis_que_formam_qualquer_celula',
                     'pode_formar_qualquer_celula',
                     'pode_vincular_esta_celula')
 order by p.proname;
-- esperado: 3 linhas. security_definer = false só na primeira.

-- 7.2) As policies de escrita já são as novas?
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'celula_membros'
 order by cmd;
-- esperado: nenhuma policy de insert/update/delete ainda citando pode_vincular_esta_celula.
-- Se alguma citar 'Quem vincula membros...', a criação da policy nova falhou.

-- 7.3) Sobrou alguma concessão que escalava?
select chave, role
  from public.permissoes_roles
 where chave = 'vincular_membros_celula'
 order by role;
-- esperado: administrador, pastor, secretaria. Sem lider, sem membro.

-- 7.4) A lista de papéis de direção está correta?
select public.papeis_que_formam_qualquer_celula();
-- esperado: {administrador,pastor,secretaria}

-- 7.5) A chave está descrita como o catálogo agora mostra?
select rotulo, descricao
  from public.permissoes
 where chave = 'vincular_membros_celula';
-- esperado: a descrição nova, mencionando o líder de célula.
