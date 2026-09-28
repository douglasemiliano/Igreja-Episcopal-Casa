-- ============================================================================
-- 20260928_diagnostico_sua_conta.sql
--
-- SOMENTE LEITURA. Duas consultas, com o seu e-mail já preenchido.
--
-- ============================================================================


-- ============================================================================
-- 1) O SEU REGISTRO DE MEMBRO
-- ============================================================================
-- As três colunas que decidem a tela:
--
--   user_id                  -> se for NULL, o login NUNCA vinculou a sua
--                                conta. A tela aparece, o "concluir" grava,
--                                e o `entrar_no_membro` da vez seguinte não
--                                acha nada por user_id e tenta casar pelo
--                                e-mail de novo. É o laço.
--   cadastro_completo        -> o que o secretaria digitou. true = registro
--                                pronto, que é o seu caso.
--   cadastro_verificado_em   -> o carimbo de "já vi esta tela". Preenchido
--                                depois que você concluir ou pular.
-- ============================================================================
select nome_completo,
       email,
       user_id,
       cadastro_completo,
       cadastro_verificado_em,
       telefone,
       data_nascimento
  from public.membros
 where lower(email) = lower('emaildedouglas@gmail.com');


-- ============================================================================
-- 2) O SEU PAPEL
-- ============================================================================
-- A tela mostrou "[permissões] 0 capacidades carregadas", e essa linha vem do
-- caminho de SUCESSO: o RPC `minhas_permissoes` respondeu com uma lista
-- vazia. Se `roles` vier nulo ou vazio, está explicado e não é bug: sem papel
-- não há permissão nenhuma, e o app esconde tudo que depende de permissão.
-- ============================================================================
select email,
       roles,
       (select count(*)
          from public.permissoes_roles pr
         where pr.role = any (coalesce(roles, '{}'))) as permissoes_desses_papeis
  from public.profiles
 where lower(email) = lower('emaildedouglas@gmail.com');


-- 2b) Se `roles` vier vazio, este é o conserto. Troque o e-mail se precisar e
--     rode de novo. `administrador` libera tudo; `secretaria` e `pastor`
--     dispensam a tela de cadastro.
--
-- update public.profiles
--    set roles = array['administrador']
--  where lower(email) = lower('emaildedouglas@gmail.com');
