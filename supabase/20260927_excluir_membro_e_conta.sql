-- ============================================================================
-- 20260927_excluir_membro_e_conta.sql
--
-- Excluir um membro passa a derrubar a conta de login junto, e a policy de
-- DELETE em `membros` deixa de estar aberta para qualquer autenticado.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA MIGRATION PRECISA FAZER ANTES DA PRIMEIRA EXECUÇÃO
-- ----------------------------------------------------------------------------
-- Duas mudanças dependem uma da outra:
--
--  1. `feed_publicacoes.autor_id` estava como `not null references
--     public.profiles(id) on delete cascade`. Como profiles tem
--     `id references auth.users(id) on delete cascade`, apagar a conta
--     cascateava: auth.users -> profiles -> feed_publicacoes. E como autor_id
--     e `not null`, o post nao sobrevivia nem desvinculado: sumia.
--
--     Um "remover da lista de membros" apagaria o mural inteiro de quem
--     saiu da igreja. A secao 2 troca por `on delete set null`.
--
--  2. A policy de DELETE que existia no banco foi criada no Dashboard como
--     "authenticated using (auth.uid() is not null)" — ou seja, QUALQUER
--     pessoa logada apaga QUALQUER membro, e o botão na interface era a unica
--     protecao. Ligar a exclusao de conta em cima disso daria a qualquer
--     usuario logado o poder de derrubar contas da igreja.
--
-- Se a secao 2 nao rodar, a exclusao de conta apaga publicacoes. A secao 8
-- verifica isso.
-- ============================================================================


-- ============================================================================
-- 1) CHAVE DE PERMISSAO
-- ============================================================================
-- Nao existia chave para excluir membro: a tela comparava roles na mao. A
-- funcao abaixo e uma nova porta que escreve em auth.users, entao precisa de
-- chave propria e nao de um tem_perfil() hardcoded.
-- ============================================================================

insert into public.permissoes (chave, rotulo, descricao, categoria, ordenacao)
values (
  'excluir_membros',
  'Excluir membros',
  'Remove o registro do membro e derruba a conta de login dele.',
  'Membros',
  31
)
on conflict (chave) do update
   set rotulo     = excluded.rotulo,
       descricao  = excluded.descricao,
       categoria  = excluded.categoria,
       ordenacao  = excluded.ordenacao;

insert into public.permissoes_roles (chave, role)
values ('excluir_membros', 'administrador'),
       ('excluir_membros', 'secretaria')
on conflict (chave, role) do nothing;


-- ============================================================================
-- 2) PUBLICACOES SOBREVIVEM A CONTA
-- ============================================================================
-- O DROP em bloco, e nao `drop constraint if exists` com nome fixo, porque
-- a coluna foi declarada duas vezes no historico do projeto: uma inline no
-- CREATE TABLE e outra por ADD CONSTRAINT nomeado. O nome automatico do
-- PostgreSQL para a inline e justamente o mesmo do nomeado, mas o bloco
-- pega qualquer variação.
-- ============================================================================

alter table public.feed_publicacoes
  alter column autor_id drop not null;

do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname      = 'feed_publicacoes'
       and rel.relnamespace = 'public'::regnamespace
       and con.contype      = 'f'
       and con.confrelid    = 'public.profiles'::regclass
       -- Só a FK de autor_id. Se algum dia outra coluna da tabela apontar
       -- para profiles, essa continua intacta.
       and con.conkey = ARRAY[(
             select att.attnum
               from pg_attribute att
              where att.attrelid = rel.oid
                and att.attname  = 'autor_id'
           )]
  loop
    execute format('alter table public.feed_publicacoes drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.feed_publicacoes
  add constraint feed_publicacoes_autor_id_fkey
  foreign key (autor_id) references public.profiles(id) on delete set null;

comment on column public.feed_publicacoes.autor_id is
  'Autor da publicacao. NULL = conta removida, mas o texto foi preservado.';


-- ============================================================================
-- 3) POLICIES DE `membros`: DELETE E INSERT
-- ============================================================================
-- Ambas as policies antigas sao removidas em bloco. Os nomes vieram do
-- Dashboard e do historico do projeto, e um DROP por nome fixo deixaria passar
-- qualquer policy aberta com nome diferente.
--
-- INSERT entra junto por causa da secao 5: 20260927_vincular_membros.sql cria
-- a propria linha do pre-cadastro por SECURITY DEFINER justamente porque a
-- policy de INSERT nao devia estar aberta. Com ela aberta, qualquer
-- autenticado escreveria membros na mao, com data_entrada e nome de batismo
-- que nao lhe pertencem, e o "cadastro_completo = true" deixaria de
-- significar que a propria pessoa preencheu.
-- ============================================================================

-- Drope por nome ANTES de qualquer bloco $$: alguns runners de SQL cortam o
-- statement no primeiro ";" e executam um DO block pela metade, o que fazia o
-- drop de baixo nunca rodar e o create logo depois bater em 42710
-- (duplicate_object) numa segunda execucao. Estas duas linhas nao dependem de
-- dollar-quoting, entao sobrevivem a isso.
--
-- Nao ha risco para a leitura: a policy de SELECT ("Usuarios autenticados
-- consultam membros") e a de UPDATE tem nome proprio e nao sao tocadas aqui.
drop policy if exists "Quem pode excluir membros apaga membros" on public.membros;
drop policy if exists "Quem pode cadastrar membros cadastra membros" on public.membros;

-- Varredura das policies antigas de INSERT/DELETE com outros nomes. O "if
-- exists" no execute cobre o caso de o runner ter cortado este bloco e o
-- proprio statement ter falhado.
do $$
declare
  r record;
begin
  for r in
    select pol.polname
      from pg_policy pol
      join pg_class rel on rel.oid = pol.polrelid
     where rel.relname      = 'membros'
       and rel.relnamespace = 'public'::regnamespace
       and pol.polcmd      in ('d', 'i')
  loop
    execute format('drop policy if exists %I on public.membros', r.polname);
  end loop;
end $$;

create policy "Quem pode excluir membros apaga membros" on public.membros
  for delete to authenticated
  using (public.pode('excluir_membros'));

create policy "Quem pode cadastrar membros cadastra membros" on public.membros
  for insert to authenticated
  with check (public.pode('cadastrar_membros'));

-- O proprio pre-cadastro do login nao passa por aqui: entra pela funcao
-- entrar_no_membro, que e SECURITY DEFINER.


-- ============================================================================
-- 4) excluir_membro_e_conta
-- ============================================================================
-- Por que funcao e nao `auth.admin.deleteUser()` no front: a SUPABASE_KEY do
-- bundle e a chave `anon`. Apagar usuario exige `service_role`, que jamais
-- pode ir para o navegador. Logo a escrita em auth.users tem de acontecer no
-- banco.
--
-- Ordem das operacoes: primeiro o registro do membro, depois a conta. Ao
-- inverso, o `on delete set null` de membros.user_id limparia a ligacao antes
-- de darmos conta de qual conta era.
-- ============================================================================

create or replace function public.excluir_membro_e_conta(p_membro_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_user_id  uuid;
  v_publicacoes integer;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Sessao ausente. Entre novamente.');
  end if;

  if not public.pode('excluir_membros') then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Voce nao tem permissao para excluir membros.');
  end if;

  select m.user_id into v_user_id
    from public.membros m
   where m.id = p_membro_id;

  if not found then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Membro nao encontrado.');
  end if;

  -- Trava contra a conta derrubar a si mesma por engano e ficar sem login.
  if v_user_id = v_uid then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Voce nao pode excluir a propria conta por aqui.');
  end if;

  -- Quantas publicacoes ficarao sem autor. O modal mostra isso antes de
  -- confirmar, e a funcao confere de novo porque o numero pode ter mudado
  -- entre a tela e o clique.
  -- profiles.id e auth.users.id sao o mesmo valor, entao comparar direto com
  -- v_user_id funciona.
  if v_user_id is not null then
    select count(*) into v_publicacoes
      from public.feed_publicacoes f
     where f.autor_id = v_user_id;
  else
    v_publicacoes := 0;
  end if;

  delete from public.membros
   where id = p_membro_id;

  if v_user_id is not null then
    -- Cascatas que acompanham esta linha:
    --   profiles       on delete cascade  (a conta perde o perfil)
    --   feed_publicacoes  set null        (o mural preserva o texto)
    --   membros.user_id / registros_batismo.membro_id  set null
    -- Excluir a conta e a forma correta de atender a um pedido de eliminacao
    -- de dados, e nao ha como desfazer: o e-mail volta a ficar livre e a
    -- pessoa nao consegue mais entrar.
    delete from auth.users
     where id = v_user_id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'conta_excluida', (v_user_id is not null),
    'publicacoes_sem_autor', v_publicacoes
  );
end;
$$;

comment on function public.excluir_membro_e_conta(uuid) is
  'Exclui o registro do membro e a conta de login. Publicacoes ficam sem autor.';


-- ============================================================================
-- 5) PERMISSOES DA FUNCAO
-- ============================================================================
-- PUBLIC tem EXECUTE por padrao em qualquer funcao nova. Esta escreve em
-- auth.users: o alcance minimo e authenticated, e mesmo assim a propria
-- funcao verifica public.pode() a cada chamada.
-- ============================================================================

revoke all on function public.excluir_membro_e_conta(uuid) from public, anon;
grant  execute on function public.excluir_membro_e_conta(uuid) to authenticated;


-- ============================================================================
-- 6) ATUALIZA A CHAVE NO MATERIAL DO CLIENT
-- ============================================================================
-- O mural ja sabe lidar com autor ausente: postagem.component.ts cai para
-- "Usuario" quando `autor` vem nulo. O que falta e o texto dizer que a conta
-- foi removida, e nao que a publicacao ficou sem ninguem por erro.
-- (Ajuste feito no front; registrado aqui para o rastro.)


-- ============================================================================
-- 7) ROLLBACK
-- ============================================================================
-- Nao ha rollback de dados aqui: o que a funcao apaga, apaga. Para desfazer o
-- efeito de estrutura, ver 20260927_excluir_membro_e_conta_rollback.sql.


-- ============================================================================
-- 8) CHECAGEM
-- ============================================================================
-- 8.1) TEM QUE VIR VAZIO. Se vier linha, sobrou policy aberta de INSERT ou
--      DELETE em membros e a funcao nao e a unica porta de escrita.
select pol.polname, pol.polcmd, pol.polqual, pol.polwithcheck
  from pg_policy pol
  join pg_class rel on rel.oid = pol.polrelid
 where rel.relname      = 'membros'
   and rel.relnamespace = 'public'::regnamespace
   and pol.polcmd      in ('i', 'd');

-- 8.2) TEM QUE VIR 'd' (delete) e 'b' (n): se vier 'a' ou 'c', a FK
--      continua em cascade e apagar conta apaga o mural.
select con.confdeltype as ao_excluir_usuario
  from pg_constraint con
 where con.conname = 'feed_publicacoes_autor_id_fkey';

-- 8.3) A FK precisa estar la. Se a secao 2 falhou no meio, a constraint antiga
--      em cascade pode ter sido removida sem a substituta ser criada.
select count(*) as fks_no_autor
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
 where rel.relname      = 'feed_publicacoes'
   and rel.relnamespace = 'public'::regnamespace
   and con.contype      = 'f'
   and con.confrelid    = 'public.profiles'::regclass;

-- 8.4) Publicacoes que sobraram sem autor apos alguma exclusao:
select count(*) as publicacoes_sem_autor
  from public.feed_publicacoes
 where autor_id is null;

-- 8.5) A funcao realmente tem permissao de escrever em auth.users. O papel
--      do dono e o que vale: SECURITY DEFINER roda como o dono.
select pg_get_userbyid(proowner) as dono,
       has_table_privilege(pg_get_userbyid(proowner), 'auth.users', 'DELETE') as pode_apagar_usuario
  from pg_proc
 where proname = 'excluir_membro_e_conta';
