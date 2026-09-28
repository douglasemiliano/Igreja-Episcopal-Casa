-- ============================================================================
-- 20260928_diagnostico_vinculo_permissoes.sql
--
-- SOMENTE LEITURA. Não altera nada. Pode rodar à vontade e várias vezes.
--
-- Responde a dois sintomas que apareceram juntos:
--
--   A) a tela /completar-cadastro fica presa em "Verificando seu cadastro";
--   B) a tela de permissões aparece vazia.
--
-- Os dois têm a mesma suspects: as migrations de 27 e 28 não terem sido
-- aplicadas por completo. Antes de mudar mais código no app, é preciso saber
-- o que o banco realmente tem.
-- ============================================================================


-- ============================================================================
-- 1) O QUE FOI APLICADO, DE FATO
-- ============================================================================
-- Cada linha responde "essa migration rodou até o fim?".
-- Coluna data_nula = a migration NAO foi aplicada.
-- ============================================================================
select 'membros.cadastro_verificado_em' as item,
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'membros'
            and column_name  = 'cadastro_verificado_em'
       ) then 'OK' else 'AUSENTE (falta 20260928)' end as situacao
union all
select 'membros.user_id',
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'membros'
            and column_name  = 'user_id'
       ) then 'OK' else 'AUSENTE (falta 20260927_vincular)' end
union all
-- Esta é a pergunta que decide o sintoma A: a função em uso é a versão nova,
-- que devolve 'verificado', ou a antiga? Se o corpo ainda NÃO mencionar
-- cadastro_verificado_em, o app pede o campo novo e recebe nada, e aí nenhum
-- login nunca é considerado verificado.
select 'entrar_no_membro (versao)',
       case when exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'entrar_no_membro'
            and p.prosrc ilike '%cadastro_verificado_em%'
       ) then 'OK (versao de 20260928)'
            when exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'entrar_no_membro'
       ) then 'ANTIGA (falta rodar 20260928)'
            else 'AUSENTE (falta 20260927_vincular)' end
union all
select 'completar_meu_cadastro (versao)',
       case when exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'completar_meu_cadastro'
            and p.prosrc ilike '%cadastro_verificado_em%'
       ) then 'OK (versao de 20260928)'
            when exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'completar_meu_cadastro'
       ) then 'ANTIGA (falta rodar 20260928)'
            else 'AUSENTE (falta 20260927_vincular)' end
union all
select 'pular_atualizacao_cadastral',
       case when exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = 'pular_atualizacao_cadastral'
       ) then 'OK' else 'AUSENTE (falta 20260928)' end
union all
select 'excluir_membro_e_conta',
       case when exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = 'excluir_membro_e_conta'
       ) then 'OK' else 'AUSENTE (falta 20260927_excluir)' end
union all
select 'public.pode()',
       case when exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'pode'
       ) then 'OK' else 'AUSENTE (fase 1 nao aplicada)' end
union all
select 'permissao excluir_membros',
       case when exists (
         select 1 from public.permissoes where chave = 'excluir_membros'
       ) then 'OK' else 'AUSENTE' end;


-- ============================================================================
-- 2) STATE DAS POLICIES DE `membros`
-- ============================================================================
-- Se aparecer INSERT ou DELETE aqui, a migration 3 do arquivo de exclusão
-- parou no meio. Se NÃO aparecer nenhum SELECT, a lista de membros some
-- inteira: é o pior estado possível aqui, e por isso a coluna `cmd` vai junto.
-- ============================================================================
select pol.polname   as policy,
       pol.polcmd    as cmd,
       case pol.polcmd
         when 'r' then 'SELECT'  when 'a' then 'INSERT'
         when 'w' then 'UPDATE'  when 'd' then 'DELETE'
         when '*' then 'TODAS'
       end           as operacao,
       pg_get_expr(pol.polqual, pol.polrelid)     as usando,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as com_check,
       pol.polroles::regrole[]::text[]            as papeis
  from pg_policy pol
  join pg_class rel on rel.oid = pol.polrelid
 where rel.relname = 'membros'
   and rel.relnamespace = 'public'::regnamespace
 order by pol.polcmd, pol.polname;


-- ============================================================================
-- 3) AS PERMISSOES ESTAO NO CATALOGO? (sintoma B, parte 1)
-- ============================================================================
-- Se isto voltar vazio, o problema é upstream: a migration da fase 1 de
-- permissões não rodou, e nenhuma tela pode mostrar nada.
-- ============================================================================
select (select count(*) from public.permissoes)       as total_permissoes,
       (select count(*) from public.permissoes_roles) as total_vinculos,
       (select count(distinct chave) from public.permissoes_roles
         where chave = 'excluir_membros')              as exclusao_membros_para_papeis;

-- Se `total_permissoes` for 0, pare aqui e me avise: o resto desta migration
-- depende do catálogo existir.


-- ============================================================================
-- 4) O CATALOGO DE PERMISSOES ESTA LEGIVEL PELA SESSAO? (sintoma B, parte 2)
-- ============================================================================
-- RLS ligado sem policy = tabela invisível para todo mundo. Se `leitura_com
-- _policy` for 0 e `leitura_com_rls` for 'S', nenhuma linha volta, e a tela
-- fica vazia mesmo com o catálogo cheio.
-- ============================================================================
select relrowsecurity as rls_ligado,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       case when relrowsecurity then 'leitura depende de policy' else 'liberado (sem RLS)' end as leitura
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('permissoes', 'permissoes_roles');


-- ============================================================================
-- 5) AS FUNCOES QUE A TELA USA EXISTEM E RESPONDEM? (sintoma A, parte 2)
-- ============================================================================
-- `pode` e `entrar_no_membro` sao as duas chamadas do login. Se alguma delas
-- nao existir ou estiver sem EXECUTE para `authenticated`, o erro aparece no
-- console do navegador como 404/403 e a tela fica presa.
-- ============================================================================
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as funcao,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_executa,
       p.proacl::text as grants
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('pode', 'minhas_permissoes', 'entrar_no_membro', 'meu_membro',
                     'completar_meu_cadastro', 'pular_atualizacao_cadastral',
                     'excluir_membro_e_conta')
 order by p.proname;


-- ============================================================================
-- 6) O USUÁRIO QUE VOCÊ ESTÁ USANDO
-- ============================================================================
-- O papel mora em `profiles.roles` (vetor de texto), e o front ainda aceita o
-- fallback em `user_metadata`, que é por isso que um papel pode existir na
-- tela e não existir aqui.
--
-- Troque o e-mail abaixo pelo seu. É o item que fecha o sintoma B: se a conta
-- não tem papel nenhum em `profiles.roles`, não há permissão para mostrar e a
-- tela fica vazia por esse motivo, e não por RLS.
-- ============================================================================
-- select
--   p.id,
--   p.email,
--   p.roles as papeis_no_perfil,
--   (select count(*)
--      from public.permissoes_roles pr
--     where pr.role = any (coalesce(p.roles, '{}'))) as permissoes_esses_papeis
--   from public.profiles p
--  where lower(p.email) = lower('SEU-EMAIL@AQUI');


-- 6b) Se a linha acima vier com papeis vazio, o problema é o vínculo da conta
--     com o perfil, e não permissão. Com login aberto, este trecho mostra quem
--     tem papel e quem não tem, sem filtrar por ninguém:
--
-- select
--   p.email,
--   p.roles,
--   (select count(*) from public.permissoes_roles pr
--     where pr.role = any (coalesce(p.roles, '{}'))) as permissoes
--   from public.profiles p
--  where p.roles is null or cardinality(p.roles) = 0
--  order by p.email;


-- ============================================================================
-- 7) PENDENTES DE MEMBRO (contexto do sintoma A)
-- ============================================================================
-- Se esta lista tiver a sua conta, o pré-cadastro foi criado e o carimbo de
-- "já viu a tela" não foi gravado. Depois de rodar 20260928, quem já passou
-- pela tela deve sair daqui.
-- ============================================================================
select m.nome_completo,
       m.email,
       m.cadastro_completo,
       m.cadastro_verificado_em
  from public.membros m
 where m.cadastro_verificado_em is null
 order by m.nome_completo nulls last
 limit 20;
