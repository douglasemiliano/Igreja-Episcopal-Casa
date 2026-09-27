-- =====================================================
-- ROLLBACK: 20260927_permissoes_policies_restantes.sql
-- =====================================================
-- Devolve as policies e a RPC ao corpo anterior, com public.tem_perfil().
-- Idempotente.
--
-- Os corpos restaurados vêm dos arquivos de origem, não de memória:
--   feed_publicacoes  20260925_roles_multiplas_e_feed.sql:214-220
--   membros           20260924_habilitar_rls.sql:31-34
--   registros_batismo 20260924_habilitar_rls.sql:57-60
--   profiles          20260925_roles_multiplas_e_feed.sql:153-166
--   saidas_caixa      20260926_saidas_e_reabertura_caixa.sql:62-96
--   reabrir_caixa     20260926_saidas_e_reabertura_caixa.sql:125-191
--
-- A fila de permissões dinâmicas continua de pé: public.pode(),
-- public.permissoes e a tela /permissoes não são tocados aqui. Depois do
-- rollback a tela volta a ser fachada para estas sete operações, e as chaves
-- de volta a não valerem nada no banco. Para desfazer as permissões
-- dinâmicas inteiras, ver 20260927_permissoes_dinamicas_rollback.sql.
--
-- Não é preciso reverter o front: nenhuma chave foi removida do catálogo, e
-- os botões que sumiram (pastor em /membros/cadastrar e em
-- /livro/batismo/cadastro) voltam a aparecer sozinhos com a concessão de
-- volta no passo 1.
-- =====================================================


-- =====================================================
-- 1) As duas concessões que a fase 2 retirou
-- =====================================================
-- Volta o pastor em cadastrar_membros e registrar_batismo, como a
-- 20260927_permissoes_dinamicas.sql havia semeado.
insert into public.permissoes_roles (chave, role)
values
  ('cadastrar_membros', 'pastor'),
  ('registrar_batismo', 'pastor')
on conflict (chave, role) do nothing;


-- =====================================================
-- 2) Policies
-- =====================================================
drop policy if exists "Administrador e líder publicam no feed" on public.feed_publicacoes;
create policy "Administrador e líder publicam no feed" on public.feed_publicacoes
  for insert to authenticated
  with check (
    public.tem_perfil(array['administrador', 'lider']::text[])
    and autor_id = auth.uid()
  );

drop policy if exists "Administração cadastra membros" on public.membros;
create policy "Administração cadastra membros" on public.membros
  for insert to authenticated
  with check (public.tem_perfil(array['administrador', 'secretaria']::text[]));

drop policy if exists "Administração cadastra registros de batismo" on public.registros_batismo;
create policy "Administração cadastra registros de batismo" on public.registros_batismo
  for insert to authenticated
  with check (public.tem_perfil(array['administrador', 'secretaria']::text[]));

drop policy if exists "Admin e pastor atualizam perfis" on public.profiles;
create policy "Admin e pastor atualizam perfis" on public.profiles
  for update to authenticated
  using (
    public.is_admin()
    or (public.tem_perfil(array['pastor']) and not (roles && array['administrador']))
  )
  with check (
    public.is_admin()
    or (
      public.tem_perfil(array['pastor'])
      and not (roles && array['administrador'])
      and public.profiles.id <> auth.uid()
    )
  );

drop policy if exists saidas_caixa_select on public.saidas_caixa;
create policy saidas_caixa_select on public.saidas_caixa
  for select to authenticated
  using (public.tem_perfil(array['administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor']::text[]));

drop policy if exists saidas_caixa_insert on public.saidas_caixa;
create policy saidas_caixa_insert on public.saidas_caixa
  for insert to authenticated
  with check (
    public.tem_perfil(array['administrador', 'caixa', 'tesouraria', 'pastor']::text[])
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  );

drop policy if exists saidas_caixa_update on public.saidas_caixa;
create policy saidas_caixa_update on public.saidas_caixa
  for update to authenticated
  using (
    public.tem_perfil(array['administrador', 'caixa', 'tesouraria', 'pastor']::text[])
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  )
  with check (
    public.tem_perfil(array['administrador', 'caixa', 'tesouraria', 'pastor']::text[])
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  );


-- =====================================================
-- 3) reabrir_caixa
-- =====================================================
-- Só a primeira linha muda: a autorização volta a ser tem_perfil(). As três
-- travas de negócio são as mesmas do arquivo de origem.
create or replace function public.reabrir_caixa(
  p_caixa_id uuid,
  p_observacoes text default null::text
)
returns public.caixas
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_caixa public.caixas;
  v_mais_recente uuid;
begin
  if not public.tem_perfil(array['administrador', 'tesouraria']::text[]) then
    raise exception 'Apenas administrador ou tesouraria podem reabrir o caixa.';
  end if;

  if exists (select 1 from public.caixas where status = 'aberto') then
    raise exception 'Já existe um caixa aberto. Feche-o antes de reabrir outro.';
  end if;

  select id into v_caixa
  from public.caixas
  where id = p_caixa_id
  for update;

  if v_caixa is null then
    raise exception 'Caixa não encontrado.';
  end if;

  if v_caixa.status = 'aberto' then
    raise exception 'Este caixa já está aberto.';
  end if;

  select id into v_mais_recente
  from public.caixas
  order by aberto_em desc
  limit 1;

  if v_mais_recente is distinct from p_caixa_id then
    raise exception 'Só é possível reabrir o caixa mais recente, para não bagunçar a contagem dos caixas seguintes.';
  end if;

  if nullif(trim(coalesce(p_observacoes, '')), '') is null then
    raise exception 'Escreva o motivo da reabertura.';
  end if;

  update public.caixas
  set status = 'aberto',
      reaberto_em = now(),
      reaberto_por = auth.uid(),
      observacoes_reabertura = trim(p_observacoes),
      vezes_reaberto = vezes_reaberto + 1,
      fechado_por = null,
      fechado_em = null,
      valor_fechamento_informado = null,
      valor_esperado = null,
      diferenca = null,
      observacoes_fechamento = null
  where id = p_caixa_id
  returning * into v_caixa;

  return v_caixa;
end;
$$;


-- =====================================================
-- 4) Recarrega o cache do PostgREST
-- =====================================================
notify pgrst, 'reload schema';


-- =====================================================
-- 5) Confirmação
-- =====================================================
-- Nenhuma das sete operações deve estar usando pode() agora.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (
    policyname in (
      'Administrador e líder publicam no feed',
      'Administração cadastra membros',
      'Administração cadastra registros de batismo',
      'Admin e pastor atualizam perfis',
      'saidas_caixa_select',
      'saidas_caixa_insert',
      'saidas_caixa_update'
    )
  )
order by tablename, cmd;
-- Esperado: toda linha com tem_perfil, nenhuma com pode.

-- O pastor voltou nas duas chaves.
select chave, string_agg(role, ', ' order by role) as papeis
from public.permissoes_roles
where chave in ('cadastrar_membros', 'registrar_batismo')
group by chave
order by chave;
-- Esperado: administrador, pastor, secretaria nas duas.
