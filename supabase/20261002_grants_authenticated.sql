-- =====================================================
-- Grants de tabela para `authenticated`
--
-- Por que este arquivo existe
-- --------------------------
-- As 40 migrations anteriores NUNCA emitiram um GRANT de tabela. Todas
-- concedem `execute` em função, que é outra coisa: o GRANT de função diz o
-- que o papel pode CHAMAR, o GRANT de tabela diz o que ele pode LER. Sem o
-- segundo, o RLS nem chega a ser avaliado - o banco nega antes, e a tela
-- devolve lista vazia sem mensagem de erro. É o sintoma clássico de "não
-- retorna nada".
--
-- No ambiente DES esses GRANTs existiam porque alguém os rodou à mão no
-- dashboard do Supabase. O `supabase db pull` que gerou o schema do PRD
-- recria as tabelas com CREATE TABLE e não traz junto o default privilege
-- do schema, então a concessão se perdeu na transposição. Este arquivo
-- versiona o que antes era uma memória humana.
--
--(modelo copiado do DES, que é o ambiente em uso e comprovadamente funciona)
--
--   tabela                              | privilegios para authenticated
--   ------------------------------------+---------------------------------
--   permissoes                           | leitura apenas
--   permissoes_roles                     | leitura apenas
--   permissoes_auditoria                 | leitura apenas
--   as outras 14 tabelas da aplicação    | leitura + escrita
--
-- As três tabelas de permissão recebem SÓ LEITURA de propósito. Quem escreve
-- nelas é o SECURITY DEFINER por trás de conceder_permissao() e
-- revogar_permissao(), e é lá que a checagem de administrador acontece. Dar
-- INSERT direto ao papel autenticado permitiria um membro logado se
-- promover a administrador, porque não passaria por nada.
--
-- Idempotente: GRANT e REVOKE são no-op quando o privilégio já está (ou não
-- está) no estado desejado, então rodar duas vezes não muda nada.
-- =====================================================

begin;

-- =====================================================
-- 1) Tabelas da aplicação: leitura + escrita
-- =====================================================
-- RLS continua mandando em quem enxerga o quê. Este GRANT só remove o
-- "permission denied" que vinha antes da policy.
grant select, insert, update, delete, references, trigger, truncate
  on table
    public.agenda_igreja,
    public.caixas,
    public.celula_membros,
    public.celulas,
    public.confirmacoes_membros,
    public.feed_publicacoes,
    public.itens_venda_arrecadacao,
    public.lecionario,
    public.livros,
    public.membros,
    public.profiles,
    public.registros_batismo,
    public.saidas_caixa,
    public.vendas_arrecadacao
  to authenticated;

-- =====================================================
-- 2) Tabelas de permissão: leitura apenas
-- =====================================================
-- A escrita chega por SECURITY DEFINER (conceder_permissao/revogar_permissao),
-- com a checagem de administrador dentro da função. Liberar escrita aqui
-- direto seria um caminho de escalação de privilégio sem nenhuma checagem.
--
-- Os GRANTs de escrita que existem hoje nestas três tabelas vieram de uma
-- configuração invertida e são removidos aqui.
revoke insert, update, delete
  on table
    public.permissoes,
    public.permissoes_roles,
    public.permissoes_auditoria
  from authenticated;

grant select, references, trigger, truncate
  on table
    public.permissoes,
    public.permissoes_roles,
    public.permissoes_auditoria
  to authenticated;

-- =====================================================
-- 3) Visitante não vê dado da igreja
-- =====================================================
-- `anon` é o papel de quem não está logado. Ele precisa existir para o
-- frontend anonymously montar a sessão, mas não deve enxergar cadastro de
-- membros nem nada do financeiro. A policy é o que filtra; o REVOKE garante
-- que a tabela inteira não fique legível nem por engano.
revoke all on table
    public.agenda_igreja,
    public.caixas,
    public.celula_membros,
    public.celulas,
    public.confirmacoes_membros,
    public.feed_publicacoes,
    public.itens_venda_arrecadacao,
    public.lecionario,
    public.livros,
    public.membros,
    public.permissoes,
    public.permissoes_roles,
    public.permissoes_auditoria,
    public.profiles,
    public.registros_batismo,
    public.saidas_caixa,
    public.vendas_arrecadacao
  from anon;

-- =====================================================
-- 4) Tabelas futuras já nascem com o GRANT certo
-- =====================================================
-- O item 3 é o que faltava e o que fez a diferença entre DES e PRD. Sem
-- esta linha, a próxima tabela criada em public repete o problema. Os
-- default privileges do schema não são versionados pelo db pull, então
-- precisam ser reconstituídos aqui.
alter default privileges in schema public
  grant select, insert, update, delete, references, trigger, truncate
  on tables to authenticated;

-- `service_role` já os tinha (é o bypass do PostgREST), mas o default do
-- schema também o declara, e um recreate de tabela o perderia do mesmo jeito.
alter default privileges in schema public
  grant all on tables to service_role;

alter default privileges in schema public
  grant all on sequences to service_role, authenticated;

alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

commit;

-- =====================================================
-- 5) Como conferir que deu certo
-- =====================================================
-- Esta lista tem que vir completa. Qualquer tabela fora dela é uma tela
-- que vai devolver vazio.
--
--   select table_name, string_agg(privilege_type, ',' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee = 'authenticated'
--    group by 1 order by 1;
--
-- Depois, com a aplicação aberta e logada, cada consulta desta deve
-- responder sem `permission denied`:
--
--   select count(*) from public.permissoes;      -- 20
--   select count(*) from public.permissoes_roles; -- 61
--   select count(*) from public.membros;
--   select count(*) from public.profiles;
