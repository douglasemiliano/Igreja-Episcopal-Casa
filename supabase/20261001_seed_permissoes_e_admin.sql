-- ============================================================================
-- 20261001_seed_permissoes_e_admin.sql
--
-- BOOTSTRAP DE AMBIENTE NOVO. Aplica o catalogo de permissoes e promove o
-- primeiro administrador.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O schema do projeto novo chega pelo `supabase db pull`, que traz ESTRUTURA e
-- nao DADOS. As tabelas `permissoes` e `permissoes_roles` saem criadas e
-- vazias, e o catalogo de chaves nunca chega: ele mora no bloco `insert into`
-- do 20260927_permissoes_dinamicas.sql, que e DDL, nao schema.
--
-- Efeito no app sem este seed: `public.pode()`
-- (supabase/20260927_permissoes_dinamicas.sql) resolve permissao por
-- `permissoes_roles`. Vazia, ela so devolve `true` para administrador, pelo
-- bypass hardcoded, e `false` para todo mundo mais. A tela /permissoes abre
-- sem nenhuma linha, entao nao ha como conceder capacidade a ninguem pela
-- interface. Alem disso `minhas_permissoes` responde lista vazia para todo
-- papel que nao seja administrador, e o app esconde as telas que dependem
-- delas.
--
-- Sem ADMIN, alem disso, nao existe quem abra /usuarios e /permissoes para
-- comecar. E `public.permissoes` tem RLS de leitura so para administrador,
-- entao o proprio seed precisa rodar fora do app - pelo SQL Editor do
-- dashboard, que conecta como `postgres` e ignora RLS. Este arquivo nao roda
-- pelo `supabase db push`.
--
-- A PRIMEIRA CONTA é o problema de chicken-and-egg do bootstrap: nao ha como
-- criar admin autenticado sem admin. Por isso o `handle_new_user()` deixa
-- todo mundo como `membro` (`profiles.roles` tem default
-- `{membro}`), e a promocao abaixo acontece por email, depois que a pessoa
-- ja se cadastrou pelo Google ou por e-mail/senha.
--
-- ORDEM
--   1. Criar a conta no dashboard (Authentication > Users > Add user).
--   2. Entrar no sistema uma vez, para o `handle_new_user()` criar o perfil.
--      Sem esse passo o `select id from auth.users` nao acha ninguem e o
--      seed nao promove ninguem.
--   3. Rodar este arquivo.
--   4. Recarregar o app e confirmar /usuarios e /permissoes.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser.
-- ============================================================================


-- ============================================================================
-- 1) Catalogo de permissoes
--
-- As linhas abaixo foram extraidas do ambiente de DES, que e o ambiente em
-- uso. Nao reescreva a mao para "arrumar": o catalogo e dado, e o caminho
-- confiavel para renovar um ambiente e o `db pull` de um ambiente que ja
-- esta correto.
--
-- `reservada` fica FORA do on conflict de proposito: a coluna e escrita por
-- migration, e regrava-la aqui permitiria que uma reexecucao acidentalmente
-- destrancasse `gerenciar_permissoes` - que e reservada ao administrador
-- justamente para que quem controla as permissoes nao possa ter a permissao
-- controlada.
-- ============================================================================
insert into public.permissoes (chave, rotulo, descricao, categoria, ordenacao, reservada) values
  ('ver_central', 'Ver a Central', 'Acesso ao painel de atalhos da igreja', 'Igreja', 10, false),
  ('publicar_evento', 'Publicar evento', 'Criar eventos na agenda', 'Igreja', 20, false),
  ('editar_evento', 'Editar evento', 'Alterar eventos existentes da agenda', 'Igreja', 21, false),
  ('excluir_evento', 'Excluir evento', 'Remover eventos da agenda', 'Igreja', 22, false),
  ('publicar_publicacao', 'Publicar no feed', 'Escrever atualizações no mural', 'Igreja', 30, false),
  ('excluir_membros', 'Excluir membros', 'Remove o registro do membro e derruba a conta de login dele.', 'Membros', 31, false),
  ('excluir_publicacao', 'Excluir publicação', 'Remover do mural posts de terceiros', 'Igreja', 31, false),
  ('operar_arrecadacoes', 'Operar o caixa', 'Lançar vendas, fiados e saídas', 'Caixa', 40, false),
  ('ver_relatorios_caixa', 'Ver relatórios de caixa', 'Consultar histórico e relatórios', 'Caixa', 41, false),
  ('reabrir_caixa', 'Reabrir caixa fechado', 'Reabrir um caixa que já foi encerrado', 'Caixa', 42, false),
  ('cadastrar_membros', 'Cadastrar membros', 'Incluir novos membros na igreja', 'Comunidade', 50, false),
  ('ver_dashboard', 'Ver dashboard', 'Consultar os indicadores da igreja', 'Comunidade', 51, false),
  ('gerenciar_celulas', 'Gerenciar células', 'Criar, editar e excluir células da igreja', 'Comunidade', 52, false),
  ('vincular_membros_celula', 'Vincular membros à célula', 'Adicionar, remover e promover membros em qualquer célula. O líder de célula não precisa desta chave: ele forma o grupo da célula que ele lidera.', 'Comunidade', 53, false),
  ('emitir_certificado', 'Emitir certificados', 'Emitir certificados de batismo e casamento', 'Registros', 60, false),
  ('ver_livro_registro', 'Ver livros de registro', 'Consultar os livros da igreja', 'Registros', 61, false),
  ('registrar_batismo', 'Registrar batismo', 'Lançar batismos no livro de registro', 'Registros', 62, false),
  ('gerenciar_lecionario', 'Gerenciar lecionário', 'Criar e editar lecionários', 'Registros', 63, false),
  ('gerenciar_usuarios', 'Gerenciar usuários', 'Ativar contas e trocar perfis', 'Administração', 70, false),
  ('gerenciar_permissoes', 'Gerenciar permissões', 'Definir quem pode fazer o quê. Reservada ao administrador: quem controla as permissões não pode ter a permissão controlada', 'Administração', 71, true)
on conflict (chave) do update
  set rotulo      = excluded.rotulo,
      descricao   = excluded.descricao,
      categoria   = excluded.categoria,
      ordenacao   = excluded.ordenacao;


-- ============================================================================
-- 2) Quem tem o que
--
-- Reproduz a distribuicao de capacidades do ambiente de DES, para que um
-- ambiente novo comece com os mesmos papeis ja operando e a migracao nao
-- mude o acesso de ninguem.
--
-- `do nothing` de proposito: reexecutar o seed nao pode apagar o que o
-- administrador configurou depois pela tela /permissoes.
--
-- `gerenciar_permissoes` nao entra em nenhuma linha, e de proposito. Quem
-- controla as permissoes nao pode ter a permissao controlada; o acesso vem do
-- bypass de administrador em `public.pode()`.
-- ============================================================================
insert into public.permissoes_roles (chave, role)
  select 'ver_central'::text as chave, 'administrador'::text as role
union all
  select 'ver_central'::text as chave, 'caixa'::text as role
union all
  select 'ver_central'::text as chave, 'lider'::text as role
union all
  select 'ver_central'::text as chave, 'pastor'::text as role
union all
  select 'ver_central'::text as chave, 'secretaria'::text as role
union all
  select 'ver_central'::text as chave, 'tesouraria'::text as role
union all
  select 'publicar_evento'::text as chave, 'administrador'::text as role
union all
  select 'publicar_evento'::text as chave, 'pastor'::text as role
union all
  select 'publicar_evento'::text as chave, 'secretaria'::text as role
union all
  select 'editar_evento'::text as chave, 'administrador'::text as role
union all
  select 'editar_evento'::text as chave, 'pastor'::text as role
union all
  select 'editar_evento'::text as chave, 'secretaria'::text as role
union all
  select 'excluir_evento'::text as chave, 'administrador'::text as role
union all
  select 'excluir_evento'::text as chave, 'pastor'::text as role
union all
  select 'excluir_evento'::text as chave, 'secretaria'::text as role
union all
  select 'publicar_publicacao'::text as chave, 'administrador'::text as role
union all
  select 'publicar_publicacao'::text as chave, 'lider'::text as role
union all
  select 'publicar_publicacao'::text as chave, 'pastor'::text as role
union all
  select 'excluir_membros'::text as chave, 'administrador'::text as role
union all
  select 'excluir_membros'::text as chave, 'secretaria'::text as role
union all
  select 'excluir_publicacao'::text as chave, 'administrador'::text as role
union all
  select 'excluir_publicacao'::text as chave, 'pastor'::text as role
union all
  select 'operar_arrecadacoes'::text as chave, 'administrador'::text as role
union all
  select 'operar_arrecadacoes'::text as chave, 'caixa'::text as role
union all
  select 'operar_arrecadacoes'::text as chave, 'pastor'::text as role
union all
  select 'operar_arrecadacoes'::text as chave, 'tesouraria'::text as role
union all
  select 'ver_relatorios_caixa'::text as chave, 'administrador'::text as role
union all
  select 'ver_relatorios_caixa'::text as chave, 'caixa'::text as role
union all
  select 'ver_relatorios_caixa'::text as chave, 'pastor'::text as role
union all
  select 'ver_relatorios_caixa'::text as chave, 'secretaria'::text as role
union all
  select 'ver_relatorios_caixa'::text as chave, 'tesouraria'::text as role
union all
  select 'reabrir_caixa'::text as chave, 'administrador'::text as role
union all
  select 'reabrir_caixa'::text as chave, 'tesouraria'::text as role
union all
  select 'cadastrar_membros'::text as chave, 'administrador'::text as role
union all
  select 'cadastrar_membros'::text as chave, 'pastor'::text as role
union all
  select 'cadastrar_membros'::text as chave, 'secretaria'::text as role
union all
  select 'ver_dashboard'::text as chave, 'administrador'::text as role
union all
  select 'ver_dashboard'::text as chave, 'pastor'::text as role
union all
  select 'ver_dashboard'::text as chave, 'secretaria'::text as role
union all
  select 'ver_dashboard'::text as chave, 'tesouraria'::text as role
union all
  select 'gerenciar_celulas'::text as chave, 'administrador'::text as role
union all
  select 'gerenciar_celulas'::text as chave, 'pastor'::text as role
union all
  select 'gerenciar_celulas'::text as chave, 'secretaria'::text as role
union all
  select 'vincular_membros_celula'::text as chave, 'administrador'::text as role
union all
  select 'vincular_membros_celula'::text as chave, 'pastor'::text as role
union all
  select 'vincular_membros_celula'::text as chave, 'secretaria'::text as role
union all
  select 'emitir_certificado'::text as chave, 'administrador'::text as role
union all
  select 'emitir_certificado'::text as chave, 'pastor'::text as role
union all
  select 'emitir_certificado'::text as chave, 'secretaria'::text as role
union all
  select 'ver_livro_registro'::text as chave, 'administrador'::text as role
union all
  select 'ver_livro_registro'::text as chave, 'pastor'::text as role
union all
  select 'ver_livro_registro'::text as chave, 'secretaria'::text as role
union all
  select 'registrar_batismo'::text as chave, 'administrador'::text as role
union all
  select 'registrar_batismo'::text as chave, 'pastor'::text as role
union all
  select 'registrar_batismo'::text as chave, 'secretaria'::text as role
union all
  select 'gerenciar_lecionario'::text as chave, 'administrador'::text as role
union all
  select 'gerenciar_lecionario'::text as chave, 'pastor'::text as role
union all
  select 'gerenciar_lecionario'::text as chave, 'secretaria'::text as role
union all
  select 'gerenciar_usuarios'::text as chave, 'administrador'::text as role
union all
  select 'gerenciar_usuarios'::text as chave, 'pastor'::text as role
union all
  select 'gerenciar_usuarios'::text as chave, 'secretaria'::text as role
on conflict (chave, role) do nothing;


-- ============================================================================
-- 3) Primeiro administrador
--
-- Promove para administrador quem ainda esta no default `{membro}`.
-- A condicao evita rebaixar quem ja foi promovido ou rebaixado de propenso.
--
-- O `in` e sobre `lower(u.email)`, e as linhas ja vem em caixa baixa. Sem o
-- sub-select de id: comparar direto o e-mail evita misturar `text` com `uuid`.
--
-- TROQUE OS EMAIS abaixo pelos seus antes de rodar.
-- ============================================================================
insert into public.profiles (id, email, roles)
select u.id,
       u.email,
       array['administrador']::text[]
  from auth.users u
 where lower(u.email) in (
    'emaildedouglasparacadastros@gmail.com',
    'adm@adm.com'
       )
   and exists (
         select 1
           from public.profiles pf
          where pf.id = u.id
            and pf.roles <@ array['membro']::text[]
       )
on conflict (id) do update
  set roles       = excluded.roles,
      atualizado_em = now();


-- ============================================================================
-- 4) Conference
--
-- Esperado: 20 permissoes, 61 vinculos papel/permissao, e os dois admins
-- acima com roles = {administrador}.
-- ============================================================================
select 'permissoes' as tabela, count(*) as esperado_20 from public.permissoes
union all
select 'permissoes_roles', count(*) from public.permissoes_roles
union all
select 'administradores', count(*)
  from public.profiles
 where roles @> array['administrador']::text[];
