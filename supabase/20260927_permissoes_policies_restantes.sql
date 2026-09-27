-- =====================================================
-- Fase 2: as policies que faltavam consultar pode()
-- =====================================================
-- Fecha o que a 20260927_permissoes_dinamicas.sql deixou pela metade. Ela
-- migrou agenda e feed; o resto do banco continuava decidindo por
-- public.tem_perfil() com a lista escrita à mão, e a tela /permissoes mexendo
-- em chaves que nenhuma policy lia. Esse é o "botão de mentira" que a seção 2
-- de docs/permissoes-dinamicas-plano.md advertiu.
--
-- O plano e as armadilhas: docs/permissoes-fase-2.md
-- O que NÃO está aqui e por quê: seção 5 deste arquivo.
--
-- REGRA QUE ESTE ARQUIVO SEGUE: nenhuma pessoa passa a poder fazer algo que
-- não podia. Onde a lista do catálogo era mais larga que a policy que ela
-- substitui, a concessão é CORRIGIDA para baixo (seção 2), e a opção de
-- deixar como o front já permitia fica comentada. A migração não pode ser a
-- hora em que alguém ganha acesso sem ninguém ter decidido isso.
--
-- Idempotente. Pode rodar mais de uma vez.
-- =====================================================


-- =====================================================
-- 1) Duas concessões que iam virar escalonamento
-- =====================================================
-- A 20260927_permissoes_dinamicas.sql semeou estas duas chaves copiando os
-- arrays do FRONT. O front permitia; a policy da tabela nunca permitiu:
--
--   cadastrar_membros    policy: tem_perfil(['administrador','secretaria'])
--                        catálogo: administrador, secretaria, pastor
--   registrar_batismo    policy: tem_perfil(['administrador','secretaria'])
--                        catálogo: administrador, secretaria, pastor
--
-- Aplicar pode() sem corrigir a concessão daria acesso de escrita em membros
-- e em registros de batismo ao pastor, que hoje é bloqueado. Retirar é a
-- escolha conservadora, e mantém a tabela e a tela falando a mesma língua:
-- com a linha removida, o pastor deixa de ver o formulário de cadastro, em vez
-- de ver um formulário que o banco recusa.
--
-- Se a igreja decidir que o pastor DEVE cadastrar membros e registrar
-- batismos (o front sempre mostrava a rota), é uma linha só:
--
--   insert into public.permissoes_roles (chave, role)
--   values ('cadastrar_membros', 'pastor')
--   on conflict do nothing;
--
delete from public.permissoes_roles
where chave in ('cadastrar_membros', 'registrar_batismo')
  and role = 'pastor';


-- =====================================================
-- 2) Feed: publicar no mural
-- =====================================================
-- Correspondência exata: a chave `publicar_publicacao` já é concedida a
-- administrador e líder, que é a mesma lista de
-- "Administrador e líder publicam no feed".
--
-- A regra por linha continua somada: `and autor_id = auth.uid()`. pode()
-- responde "este papel pode", e não "este papel pode em cima do texto do
-- outro". Publicar no mural de outra pessoa não é a mesma coisa que publicar
-- no próprio.
drop policy if exists "Administrador e líder publicam no feed" on public.feed_publicacoes;
create policy "Administrador e líder publicam no feed" on public.feed_publicacoes
  for insert to authenticated
  with check (public.pode('publicar_publicacao') and autor_id = auth.uid());


-- =====================================================
-- 3) Membros: cadastrar
-- =====================================================
-- Só o INSERT. UPDATE e DELETE de membros ficam de fora de propósito:
-- a tela /membros não tem chave nenhuma para eles, então amarrar a escrita
-- aqui produziria botão visível que o banco recusa. Ver seção 5.
drop policy if exists "Administração cadastra membros" on public.membros;
create policy "Administração cadastra membros" on public.membros
  for insert to authenticated
  with check (public.pode('cadastrar_membros'));


-- =====================================================
-- 4) Registros de batismo: registrar
-- =====================================================
-- Mesmo motivo: só o INSERT, que é o que a rota
-- /livro/batismo/cadastro já exige por `registrar_batismo`.
drop policy if exists "Administração cadastra registros de batismo" on public.registros_batismo;
create policy "Administração cadastra registros de batismo" on public.registros_batismo
  for insert to authenticated
  with check (public.pode('registrar_batismo'));


-- =====================================================
-- 5) Perfis: trocar papéis
-- =====================================================
-- A chave `gerenciar_usuarios` cobre o nível de papel, e as regras por linha
-- continuam ao lado dela. Uma policy que usasse só pode() devolveria ao
-- pastor a edição de perfil de administrador e a do próprio perfil — as duas
-- coisas que a policy anterior proibia de propósito.
--
-- Efeito colateral bom: como a regra por linha continua, conceder
-- `gerenciar_usuarios` a outro papel pela tela o habilita sem dar poder
-- sobre administrador nem sobre a própria conta. A configuração passa a
-- alcançar combinações que a lista fixa não expressava.
--
-- O INSERT em profiles segue SEM policy. Não é um buraco: quem cria perfil é
-- o gatilho handle_new_user(), security definer, no signup. A policy de
-- insert foi removida em 20260925_roles_multiplas_e_feed.sql e nunca voltou
-- por um bom motivo. Criá-la aqui mudaria comportamento; fica para outra
-- conversa.
drop policy if exists "Admin e pastor atualizam perfis" on public.profiles;
create policy "Admin e pastor atualizam perfis" on public.profiles
  for update to authenticated
  using (
    public.pode('gerenciar_usuarios')
    and (
      public.is_admin()
      or (
        not (roles && array['administrador']::text[])
        and public.profiles.id <> auth.uid()
      )
    )
  )
  with check (
    public.pode('gerenciar_usuarios')
    and (
      public.is_admin()
      or (
        not (roles && array['administrador']::text[])
        and public.profiles.id <> auth.uid()
      )
    )
  );


-- =====================================================
-- 6) Saídas de caixa
-- =====================================================
-- Correspondência exata nos dois sentidos:
--   SELECT  ver_relatorios_caixa = administrador, secretaria, caixa, tesouraria, pastor
--   INSERT  operar_arrecadacoes = administrador, caixa, tesouraria, pastor
--   UPDATE  operar_arrecadacoes = administrador, caixa, tesouraria, pastor
--
-- A segunda condição de cada policy — só mexer em caixa aberto — é regra de
-- negócio, não permissão, e continua idêntica. `caixa_id` aqui é a coluna da
-- linha de saidas_caixa que está sendo avaliada.
drop policy if exists saidas_caixa_select on public.saidas_caixa;
create policy saidas_caixa_select on public.saidas_caixa
  for select to authenticated
  using (public.pode('ver_relatorios_caixa'));

drop policy if exists saidas_caixa_insert on public.saidas_caixa;
create policy saidas_caixa_insert on public.saidas_caixa
  for insert to authenticated
  with check (
    public.pode('operar_arrecadacoes')
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  );

drop policy if exists saidas_caixa_update on public.saidas_caixa;
create policy saidas_caixa_update on public.saidas_caixa
  for update to authenticated
  using (
    public.pode('operar_arrecadacoes')
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  )
  with check (
    public.pode('operar_arrecadacoes')
    and exists (
      select 1 from public.caixas c
      where c.id = caixa_id and c.status = 'aberto'
    )
  );

-- DELETE fica fora: a lista é administrador e tesouraria, e não existe chave
-- com esse par para "excluir saída". A chave `reabrir_caixa` tem exatamente o
-- mesmo par de papéis, mas nomear a exclusão de uma saída como "reabrir
-- caixa" seria mentir sobre o que a chave faz. Ver seção 5.


-- =====================================================
-- 7) Reabrir caixa
-- =====================================================
-- Correspondência exata: `reabrir_caixa` é concedida a administrador e
-- tesouraria, o mesmo par que a função exigia.
--
-- As três travas de negócio (nenhum caixa aberto, só o mais recente, motivo
-- obrigatório) seguem intactas. Só a autorização troca de forma.
--
-- `abrir_caixa` e `fechar_caixa` NÃO entram aqui: o par que elas exigem é
-- administrador e tesouraria, e nenhuma chave do catálogo tem esse par para
-- "abrir e fechar o caixa". Usar `operar_arrecadacoes` daria a caixa e pastor
-- o poder de abrir a gaveta, que hoje não têm. Ver seção 5.
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
  if not public.pode('reabrir_caixa') then
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

  -- Trava do "dia seguinte": o caixa reabrível é sempre o mais recente.
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
      -- o fechamento anterior não vale mais: será substituído
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
-- 8) Recarrega o cache do PostgREST
-- =====================================================
notify pgrst, 'reload schema';


-- =====================================================
-- 9) O que NÃO está aqui, e por quê
-- =====================================================
-- Nenhuma dessas omissões é esquecimento. Todas exigem trabalho de front
-- antes de virar policy, senão a tela passa a esconder botão que o usuário
-- precisa ver, ou a mostrar botão que o banco recusa.
--
-- TABELAS SEM RLS — não tocar às cegas
--   caixas, vendas_arrecadacao, itens_venda_arrecadacao, lecionario
--   Nenhum script do repositório liga RLS nelas. `enable row level security`
--   em uma tabela sem nenhuma policy bloqueia a leitura para todo mundo, e o
--   estado atual delas (se houver policy) foi criado direto no Dashboard e
--   não está versionado. Rodar 20260927_diagnostico_rls.sql primeiro.
--
-- OPERAÇÕES SEM CHAVE
--   abrir e fechar caixa      -> precisa de chave nova (admin + tesouraria)
--   excluir saida de caixa    -> precisa de chave nova (admin + tesouraria)
--   editar/excluir membro     -> precisa de chave nova (admin + secretaria)
--   editar/excluir livro      -> precisa de chave nova (admin + secretaria)
--   editar/excluir batismo    -> precisa de chave nova (admin + secretaria)
--
--   Em todos os casos, criar a chave é a parte fácil. A parte que importa é
--   ligar a chave ao botão, para o front e o banco concordarem.
--
-- CHAVES QUE SÃO SÓ PORTÃO DE NAVEGAÇÃO — e está tudo bem
--   ver_central, ver_dashboard
--   São índices de atalhos e indicadores. Não há tabela para amarrar.
--
--   emitir_certificado
--   A tela gera o PDF no navegador (html2canvas) e não escreve em tabela
--   nenhuma. Não há o que proteger no banco.


-- =====================================================
-- 10) Confirmação
-- =====================================================
-- Nenhuma policy de escrita deve continuar com tem_perfil.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and cmd in ('insert', 'update', 'delete')
  and (qual like '%tem_perfil%' or with_check like '%tem_perfil%')
order by tablename, cmd;
-- Esperado: só os de membros/registros_batismo/livros (UPDATE e DELETE) e
-- saidas_caixa_delete, que são as omissões documentadas na seção 9.

-- As tabelas do diagnóstico não devem ter mudado de estado.
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('caixas', 'vendas_arrecadacao',
                    'itens_venda_arrecadacao', 'lecionario')
order by c.relname;

-- As duas concessões corrigidas não podem ter voltado.
select chave, role
from public.permissoes_roles
where chave in ('cadastrar_membros', 'registrar_batismo')
order by chave, role;
-- Esperado: administrador e secretaria em cada uma, sem pastor.
