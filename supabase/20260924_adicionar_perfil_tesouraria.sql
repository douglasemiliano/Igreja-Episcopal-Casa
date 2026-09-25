-- =====================================================
-- Novo perfil: Tesouraria (permissão de caixa)
-- =====================================================

-- Remove a constraint existente e recria incluindo a role 'tesouraria'
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('administrador', 'secretaria', 'caixa', 'tesouraria', 'leitor'));