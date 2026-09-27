-- =====================================================
-- Diagnóstico: o que a RLS está fazendo, de fato, agora
-- =====================================================
-- SOMENTE LEITURA. Não altera nada. Pode rodar à vontade.
--
-- Rodar ANTES de 20260927_permissoes_policies_restantes.sql e colar o
-- resultado num arquivo versionado, junto do resultado de depois. É o
-- registro de que a migration não mudou quem acessa o quê.
--
-- Cinco perguntas, mais um inventário:
--   1) Quais tabelas de public têm RLS ligado, e quais não têm?
--   2) Quais operações de escrita ainda decidem por tem_perfil(), e não
--      por pode()?  (o que ainda é "botão de mentira")
--   2b) Quais funções `security definer` ainda decidem por tem_perfil()?
--   3) O papel `authenticated` tem ALL nas tabelas de permissão, sem revoke
--      explícito?  (permitiria contornar a auditoria)
--   4) Quais chaves do catálogo nenhuma policy nem função consulta?
--   5) Para cada chave: onde ela é consultada, ou em lugar nenhum?
--   6) Inventário literal de toda policy de public, com o corpo completo.
--
-- A 6 é a que mais importa e a que mais se esquece: ela não filtra nada. É o
-- que separa "o banco está como estes arquivos descrevem" de "o banco está
-- como eu espero que esteja". As policies do Dashboard não estão em nenhum
-- arquivo do repositório, e a migration presume que conhece todas as bodies que
-- vai substituir.
--
-- As tabelas sem RLS são o item mais caro desta lista: enable row level
-- security em uma tabela sem nenhuma policy bloqueia a leitura para todo
-- mundo. Por isso a migration de policies NÃO toca nelas.
-- =====================================================


-- =====================================================
-- 1) Coverage de RLS em public
-- =====================================================
-- "SEM RLS" na saída = nenhuma policy existe para essa tabela, então nada é
-- filtrado. O que decide o acesso passa a ser só o GRANT da tabela. Se o
-- GRANT para `authenticated` existir, qualquer membro logado lê tudo que há
-- nela. Se não existir, a tela some — e por isso o GRANT também é dado.
select
  c.relname as tabela,
  c.relrowsecurity as rls_ligado,
  case
    when not c.relrowsecurity then 'SEM RLS — leitura liberada'
    when not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
    ) then 'RLS LIGADO, ZERO POLICIES — ninguém lê nem escreve'
    else 'ok'
  end as situacao
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by (not c.relrowsecurity) desc, c.relname;


-- =====================================================
-- 2) Policies de escrita que ainda usam tem_perfil()
-- =====================================================
-- Não tem `pode()` em nenhuma delas, e tem `tem_perfil()`. Cada linha é uma
-- policy, não uma chave: `tem_perfil` recebe papéis, não a chave da tela. É
-- para comparar com o catálogo de `docs/permissoes-fase-2.md`, seção 3, e ver
-- onde a lista de papéis do banco é mais estreita que a lista do catálogo.
select
  tablename as tabela,
  policyname as policy,
  cmd,
  qual as usando,
  with_check
from pg_policies
where schemaname = 'public'
  and cmd in ('insert', 'update', 'delete')
  and (qual like '%tem_perfil%' or with_check like '%tem_perfil%')
order by tablename, cmd;


-- =====================================================
-- 2b) O mesmo, para as funções (RPCs)
-- =====================================================
-- Uma RPC `security definer` é uma policy que não aparece em pg_policies.
-- Abrir e fechar o caixa moram aqui.
select
  p.proname as funcao,
  pg_get_function_identity_arguments(p.oid) as argumentos,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and p.prosrc ~ 'tem_perfil'
order by p.proname;


-- =====================================================
-- 3) `authenticated` com ALL em tabela que não deveria
-- =====================================================
-- `tem_all` verdadeiro aqui significa que o papel pode escrever direto pelo
-- REST, sem passar por RPC — e, nas tabelas de permissão, sem passar pelo
-- gatilho de auditoria.
select
  c.relname as tabela,
  has_table_privilege('authenticated', c.oid, 'INSERT') as pode_inserir,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as pode_atualizar,
  has_table_privilege('authenticated', c.oid, 'DELETE') as pode_excluir
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('permissoes', 'permissoes_roles', 'permissoes_auditoria')
order by c.relname;


-- =====================================================
-- 4) Chaves do catálogo que nenhuma policy nem função consulta
-- =====================================================
-- Procurar só em `qual` erra: numa policy de INSERT, `qual` é NULL e a
-- checagem vive em `with_check`. Sem o OR, toda chave exercida apenas por
-- INSERT — cadastrar_membros, registrar_batismo, publicar_publicacao — é
-- reportada como não aplicada quando está aplicada. Por isso as duas colunas.
--
-- Saída esperada depois da fase 2:
--   ver_central, ver_dashboard, emitir_certificado -> navegação pura, sem
--     tabela para amarrar
--   ver_livro_registro, gerenciar_lecionario -> protegem rota, mas nenhuma
--     policy as consulta: a tabela decide por fora
--   publicar_publicacao -> exercida só por `pode()` dentro da policy de
--     INSERT do feed, com o extra de 'publicado'
--
-- As chaves com `(nenhuma policy)` e `(nenhuma função)` na query 5 são a
-- mesma lista, com o motivo. Se as duas divergirem, alguma das duas está errada.
select p.chave
from public.permissoes p
where p.reservada = false
  and not exists (
    select 1
    from pg_policies pol
    where pol.schemaname = 'public'
      and (pol.qual like '%' || p.chave || '%'
           or pol.with_check like '%' || p.chave || '%')
  )
  and not exists (
    select 1
    from pg_proc pr
    join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public'
      and pr.prosrc like '%' || p.chave || '%'
  )
order by p.chave;


-- =====================================================
-- 5) Onde cada chave é consultada, de verdade
-- =====================================================
-- Substitui uma versão anterior desta query que cruzava as chaves com todas as
-- policies de escrita por `left join lateral ... on true`. O produto
-- cartesiano não dizia qual chave conversava com qual policy, e quando não
-- havia policy alguma com `tem_perfil` o resultado saía inteiro em NULL —
-- silenciosamente, como se fosse um dado.
--
-- Esta é a query que responde a pergunta: para cada chave, se ela aparece no
-- corpo de alguma policy, no corpo de alguma função, ou em nenhum dos dois.
-- `em_policies` e `em_funcoes` vazios = a chave é só interface.
--
-- O `_` das chaves é wildcard em LIKE, mas casa com ele mesmo e nenhuma chave
-- é substring de outra, então não há falso positivo. As chaves não contêm
-- `%`.
select
  p.chave,
  case when p.reservada then 'reservada' else 'ativa' end as situacao,
  coalesce(
    (select string_agg(
              pol.tablename || '/' || pol.policyname || ' (' || pol.cmd || ')', ', '
            order by pol.tablename, pol.cmd)
     from pg_policies pol
     where pol.schemaname = 'public'
       and (pol.qual like '%' || p.chave || '%'
            or pol.with_check like '%' || p.chave || '%')),
    '(nenhuma policy)'
  ) as em_policies,
  coalesce(
    (select string_agg(pr.proname, ', ' order by pr.proname)
     from pg_proc pr
     join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public'
       and pr.prosrc like '%' || p.chave || '%'),
    '(nenhuma função)'
  ) as em_funcoes
from public.permissoes p
order by p.reservada desc, p.chave;
--
-- Leitura do resultado:
--   as duas colunas preenchidas  -> a tela e o banco concordam
--   '(nenhuma policy)' + filled -> a chave abre a tela, e a tabela decide por
--                                  fora (tem_perfil, ou o que estiver lá)
--   ambas '(nenhuma ...)'       -> chave puramente de navegação
-- =====================================================


-- =====================================================
-- 6) Inventário literal: toda policy de public, com o corpo
-- =====================================================
-- Sem filtro. Sem agrupar. Isso não é análise, é foto.
--
-- A fase 2 faz `drop policy` em sete policies e confia que conhece o corpo de
-- cada uma. Essa query é o que transforma essa confiança em fato. Se aqui
-- aparecer uma policy cujo corpo não bate com o que os arquivos do
-- repositório dizem, a migration não deve rodar ainda: o rollback dela
-- restituiria um corpo errado.
--
-- O `permissive` e o `roles` importam junto do corpo: duas policies
-- permissivas se somam por OR, então uma policy larga em outra tabela não
-- protege esta. E `qual` e `with_check` são separados de propósito — ler e
-- escrever são decisões separadas, e `select` só usa `qual`.
select
  tablename as tabela,
  policyname as policy,
  cmd as comando,
  roles::text as papeis,
  permissive as permissiva,
  coalesce(nullif(qual, ''), '(vazio)') as usando,
  coalesce(nullif(with_check, ''), '(vazio)') as com_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;
--
-- Como ler: para cada `tabela / policy` que a fase 2 toca, o corpo de `usando`
-- e `com_check` tem de ser o que está em 20260925_roles_multiplas_e_feed.sql e
-- 20260926_saidas_e_reabertura_caixa.sql. Qualquer diferença é policy criada
-- direto no Dashboard, e aí o caminho é ler a tela de SQL do Supabase e
-- versionar antes de qualquer coisa.
-- =====================================================
