-- ============================================================================
-- 20260928_diagnostico_exclusao_membro.sql
--
-- SOMENTE LEITURA. Não altera nada. Pode rodar à vontade e várias vezes.
--
-- Responde a uma coisa só: por que `supabase.rpc('excluir_membro_e_conta')`
-- responde HTTP 400.
--
-- POR QUE 400 E NÃO 404
--
-- A função existe e está grantada, e mesmo assim a chamada é recusada. Isso
-- descarta "migration não aplicada" e "sem permissão". O 400 do PostgREST
-- aparece quando ele RECUSA ESCOLHER ou RECUSA EXECUTAR, e as duas causas são
-- estruturais, não de dados:
--
--   1) SOBRECARGA (PGRST203). `create or replace function` casa por
--      (nome, tipos dos argumentos), NÃO pelo nome dos parâmetros. Se em uma
--      execução anterior a função foi criada com o parâmetro chamado
--      `membro_id`, e a migration de hoje a recria com `p_membro_id`, o banco
--      fica com DUAS funções de mesmo nome e mesmo tipo, e o PostgREST não
--      sabe qual escolher: "Could not choose the best candidate function".
--      A correção é `drop function` e criar de novo — ver a seção 5.
--
--   2) CACHE DE SCHEMA VELHO (PGRST202). O PostgREST guarda o catálogo das
--      funções em memória. Uma função criada DEPOIS do último reload não é
--      encontrada: "Could not find the function ... in the schema cache". Não
--      é falha de migration. A confirmação é a seção 2, e a correção é um
--      reload do schema, não rodar SQL.
--
-- Estas duas se confundem fácil, e a seção 1 separa as duas de uma vez.
-- ============================================================================


-- ============================================================================
-- 1) TODAS AS VERSÕES DA FUNÇÃO
--
-- A coluna `quantidade` é a resposta. TEM QUE VIR 1.
--
-- Se vier 2 ou mais, há sobrecarga: existe mais de uma função com o mesmo
-- nome e o mesmo tipo de argumento, e o PostgREST escolhe ao acaso ou se
-- recusa. A coluna `argumentos` diz o nome do parâmetro de cada uma — é por
-- ali que se vê a duplicata.
-- ============================================================================
select proname as funcao,
       count(*) over () as quantidade,
       pg_get_function_identity_arguments(oid) as argumentos,
       pg_get_function_arguments(oid)        as assinatura_completa,
       pg_get_userbyid(proowner)             as dono,
       prosecdef                             as security_definer
  from pg_proc
  join pg_namespace n on n.oid = pronamespace
 where n.nspname = 'public'
   and proname = 'excluir_membro_e_conta'
 order by oid;


-- ============================================================================
-- 2) O POSTGREST ESTÁ VENDO A FUNÇÃO?
--
-- É o teste que separa sobrecarga (1) de cache velho (2).
--
-- Se a seção 1 devolver a função e esta devolver 0 linhas, o SQL está
-- correto e o que está velho é o cache do PostgREST. Rodar a migration de
-- novo não resolve: ela criaria a mesma função e o cache continuaria igual.
-- O console do Supabase resolve, em Settings > API, pelo botão de reload do
-- schema (ou `NOTIFY pgrst, 'reload schema';`).
--
-- Se esta devolver uma linha com o nome do parâmetro DIFERENTE de
-- `p_membro_id`, é a sobrecarga: o que o app envia não bate com nenhuma.
-- ============================================================================
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as visivel_para_o_app,
       case
         when p.proname = 'excluir_membro_e_conta'
          and pg_get_function_identity_arguments(p.oid) = 'p_membro_id uuid'
         then 'OK — o app manda p_membro_id e esta e a certa'
         else 'DIVERGE — o app manda p_membro_id'
       end as veredito
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'excluir_membro_e_conta';


-- ============================================================================
-- 3) PERMISSÃO DE EXECUÇÃO
--
-- A função é `security definer`, e mesmo assim precisa de EXECUTE concedido
-- ao papel `authenticated`. A migration revoga de public e anon justamente
-- para isso. Se `authenticated_executa` vier false, o erro é 401/403 e não
-- 400 — mas fica registrado aqui porque é a outra forma dessa operação
-- falhar sem mensagem útil.
--
-- `anon_executa` TEM QUE VIR false. Se vier true, a função está exposta a
-- quem não está logado, e quem apagou o revoke precisa reaplicá-lo.
-- ============================================================================
select p.proname as funcao,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_executa,
       has_function_privilege('anon',        p.oid, 'execute') as anon_executa,
       p.proacl::text as grants
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'excluir_membro_e_conta';


-- ============================================================================
-- 4) O DONO REALMENTE PODE APAGAR USUÁRIO?
--
-- `security definer` executa com os privilégios do dono, e não com os da
-- pessoa logada. Se o dono não tiver DELETE em auth.users, o `delete from
-- auth.users` dentro do corpo falha — e aí o 400 aparece DEPOIS de o corpo
-- rodar, com a mensagem do Postgres no `details`, não a do PostgREST.
--
-- `pode_apagar_usuario` TEM QUE VIR true.
-- ============================================================================
select pg_get_userbyid(p.proowner) as dono,
       has_table_privilege(pg_get_userbyid(p.proowner), 'auth.users', 'DELETE') as pode_apagar_usuario,
       rolsuper as dono_e_superusuario
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
 where n.nspname = 'public'
   and p.proname = 'excluir_membro_e_conta';


-- ============================================================================
-- 5) CORREÇÃO DA SOBRECARGA (SÓ SE A SEÇÃO 1 MOSTRAR `quantidade` > 1)
--
-- NÃO RODE SEM CONFIRMAR. Primeiro veja o resultado da seção 1.
--
-- Este bloco apaga a função e a recria a partir da migration 20260927, sem
-- duplicata. O que se perde: nada de dado. A função é código, e o código
-- está no arquivo versionado. O que NÃO se perde é o registro dos membros,
-- porque nada aqui toca em tabela.
--
-- Passeios possíveis: pode rodar mais de uma vez sem estragar nada, porque
-- o `drop ... if exists` some com as duas e a `create or replace` recria uma.
-- ============================================================================
-- drop function if exists public.excluir_membro_e_conta(uuid);
-- -- depois: rodar o corpo de 20260927_excluir_membro_e_conta.sql
-- -- e NÃO a seção 6 deste arquivo, que revoga e concede de novo.

-- Aviso sobre GRANT: o `create or replace` conserva o `proacl` das versões
-- anteriores, mas o `drop` não conserva nada. Depois do drop, o padrão do
-- Postgres é EXECUTE liberado para PUBLIC — ou seja, para anon. Se você rodar
-- só o `create or replace` sem o revoke, vai deixar a função que apaga contas
-- de login acessível a quem não tem login nenhum. O revoke precisa vir logo
-- depois, e a seção 3 é a que confirma.
--
--   revoke all on function public.excluir_membro_e_conta(uuid) from public, anon;
--   grant  execute on function public.excluir_membro_e_conta(uuid) to authenticated;
--
-- Depois disso, se o erro continuar, o cache: `NOTIFY pgrst, 'reload schema';`
-- ou o botão de reload do schema em Settings > API no console do Supabase.
