-- ============================================================================
-- 20260927_vincular_membros.sql
--
-- Liga a conta de login (auth.users/profiles) ao registro em public.membros.
--
-- Hoje profiles e membros sao duas tabelas soltas: sem FK, sem trigger, sem
-- join. As duas tem email, mas nada compara um com o outro e a correspondencia
-- e feita a olho por alguem. Esta migration cria essa ligacao.
--
-- Fluxo:
--   1. usuario faz login
--   2. entrar_no_membro() procura em membros pelo email normalizado
--        - achou exatamente 1 e ele nao esta vinculado -> vincula
--        - achou mais de 1                          -> 'ambiguo', nao vincula
--        - nao achou                                -> cria pre-cadastro
--   3. se o pre-cadastro ficou cadastro_completo = false, o CadastroGuard
--      manda a pessoa para /completar-cadastro
--
-- Nao ha policy nova de INSERT em membros. A escrita acontece por dentro de
-- uma funcao SECURITY DEFINER, que so aceita user_id = auth.uid(). Abrir a
-- policy deixaria qualquer autenticado escrever coluna por coluna, incluindo
-- data_entrada e nome de batismo.
-- ============================================================================


-- ============================================================================
-- 1) COLUNAS DE LIGACAO
-- ============================================================================

alter table public.membros
  add column if not exists user_id uuid references auth.users(id) on delete set null;

comment on column public.membros.user_id is
  'Conta de login ligada a este membro. NULL = ainda nao fez login.';

-- Sem default nesta linha, de proposito: com default false o PostgreSQL
-- marcaria tambem as linhas ja existentes como incompletas, e a igreja toda
-- cairia na tela de completar cadastro. Coluna nasce nula; o backfill abaixo
-- e que decide quem e completo.
alter table public.membros
  add column if not exists cadastro_completo boolean;

comment on column public.membros.cadastro_completo is
  'false = pre-cadastro aberto pelo login, ainda sem os dados que so a pessoa tem.';


-- ============================================================================
-- 2) BACKFILL
-- ============================================================================
-- Quem ja estava em membros foi cadastrado pela secretaria com os dados que a
-- propria pessoa passou. Todos sao completos.
-- ============================================================================

update public.membros
   set cadastro_completo = true
 where cadastro_completo is null;

alter table public.membros
  alter column cadastro_completo set default false;

alter table public.membros
  alter column cadastro_completo set not null;


-- ============================================================================
-- 3) INDICES
-- ============================================================================

-- 1 conta para 1 membro. Parcial porque varios membros ainda tem user_id nulo
-- (ainda nao entraram) e NULL nao pode ser repetido num indice unico.
create unique index if not exists idx_membros_user_id_uniq
  on public.membros (user_id)
  where user_id is not null;

-- A busca do login normaliza o email toda vez, entao o indice precisa bater
-- com a expressao, nao com a coluna crua.
create index if not exists idx_membros_email_normalizado
  on public.membros (lower(btrim(coalesce(email, ''))));


-- ============================================================================
-- 4) email_normalizado
-- ============================================================================
-- 'Teste@Gmail.com', 'teste@gmail.com' e ' teste@gmail.com ' sao a mesma
-- pessoa e precisam cair no mesmo membro. Sem isso o login criava pre-cadastro
-- duplicado de quem ja estava na lista.
-- ============================================================================

create or replace function public.email_normalizado(valor text)
returns text
language sql
immutable
as $$
  select lower(btrim(coalesce(valor, '')));
$$;


-- ============================================================================
-- 5) entrar_no_membro
-- ============================================================================
-- Idempotente. Pode ser chamada em toda navegacao: se o usuario ja esta
-- vinculado, devolve o mesmo resultado sem escrever nada.
--
-- Retorna jsonb:
--   status        'vinculado' | 'pre_cadastro' | 'ambiguo' | 'sem_email' | 'erro'
--   id            id do membro quando houver
--   nome          nome do membro quando houver
--   completo      boolean
--   mensagem      texto pronto para o front, so no status 'erro'
-- ============================================================================

create or replace function public.entrar_no_membro()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_nome     text;
  v_id       uuid;
  v_nome_mem text;
  v_completo boolean;
  v_qtd      integer;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Sessao ausente. Entre novamente.');
  end if;

  -- 5.1) Ja vinculado?
  select m.id, m.nome_completo, m.cadastro_completo
    into v_id, v_nome_mem, v_completo
    from public.membros m
   where m.user_id = v_uid
   limit 1;

  if v_id is not null then
    return jsonb_build_object('status', 'vinculado',
                              'id', v_id,
                              'nome', v_nome_mem,
                              'completo', v_completo);
  end if;

  v_email := public.email_normalizado(
    coalesce(auth.jwt() ->> 'email', '')
  );

  if v_email = '' then
    return jsonb_build_object('status', 'sem_email');
  end if;

  -- 5.2) Bate com membro ja cadastrado?
  select count(*)
    into v_qtd
    from public.membros m
   where m.user_id is null
     and public.email_normalizado(m.email) = v_email;

  if v_qtd = 1 then
    update public.membros m
       set user_id = v_uid
     where m.user_id is null
       and public.email_normalizado(m.email) = v_email
    returning m.id into v_id;

    -- cadastro_completo nao e tocado: se a secretaria ja tinha o registro
    -- completo ele continua completo; se era um pre-cadastro de outra pessoa,
    -- a pessoa nova cai na tela de completar e nao rouba o que faltava.
    select m.nome_completo, m.cadastro_completo
      into v_nome_mem, v_completo
      from public.membros m
     where m.id = v_id;

    return jsonb_build_object('status', 'vinculado',
                              'id', v_id,
                              'nome', v_nome_mem,
                              'completo', v_completo);
  end if;

  if v_qtd > 1 then
    -- Mais de um registro com o mesmo email. Nao da para saber qual e o
    -- certo, e escolher um erradoassocia a conta ao membro errado.
    -- A secretaria resolve pelo painel de usuarios.
    return jsonb_build_object('status', 'ambiguo',
                              'quantidade', v_qtd);
  end if;

  -- 5.3) Nao bate com ninguem: abre pre-cadastro.
  -- O nome vem do profiles, que o trigger on_auth_user_created ja preencheu a
  -- partir do metadata do Google. Sem isso o pre-cadastro nasceria com o
  -- pedaco antes do @ e a pessoa teria de corrigir o proprio nome.
  select coalesce(nullif(btrim(p.nome), ''), split_part(v_email, '@', 1))
    into v_nome
    from public.profiles p
   where p.id = v_uid;

  v_nome := coalesce(v_nome, split_part(v_email, '@', 1));

  begin
    insert into public.membros (user_id, nome_completo, email, cadastro_completo)
    values (v_uid, v_nome, v_email, false)
    returning id into v_id;
  exception
    when others then
      return jsonb_build_object(
        'status', 'erro',
        'mensagem', 'Nao foi possivel abrir o pre-cadastro: ' || sqlerrm
      );
  end;

  return jsonb_build_object('status', 'pre_cadastro',
                            'id', v_id,
                            'nome', v_nome,
                            'completo', false);
end;
$$;

comment on function public.entrar_no_membro() is
  'Vincula a conta ao membro pelo email, ou abre pre-cadastro. Idempotente.';


-- ============================================================================
-- 6) meu_membro
-- ============================================================================
-- Leitura pura, sem efeito colateral. E o que o CadastroGuard usa para decidir
-- se precisa mandar a pessoa para /completar-cadastro.
-- ============================================================================

create or replace function public.meu_membro()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'existe',      (m.id is not null),
           'id',          m.id,
           'nome',        m.nome_completo,
           'email',       m.email,
           'telefone',    m.telefone,
           'data_nascimento', m.data_nascimento,
           'sexo',        m.sexo,
           'endereco',    m.endereco,
           'funcao',      m.funcao,
           'completo',    coalesce(m.cadastro_completo, false)
         )
    from public.membros m
   where m.user_id = auth.uid()
   limit 1;
$$;

comment on function public.meu_membro() is
  'Leitura do membro ligado a conta atual. Nao cria nem altera nada.';


-- ============================================================================
-- 7) completar_meu_cadastro
-- ============================================================================
-- Fecha o pre-cadastro. SECURITY DEFINER porque a policy de INSERT em membros
-- e da secretaria -- e nao vamos abrir. A funcao so aceita mexer na linha em
-- que o proprio user_id aponta.
--
-- Os parametros sao o que a tela de completar cadastro coleta. O que nao
-- entra aqui (data_entrada, nome de batismo, cargo eclesico) e da secretaria.
-- ============================================================================

create or replace function public.completar_meu_cadastro(
  p_nome            text,
  p_telefone        text default null,
  p_data_nascimento date default null,
  p_sexo            text default null,
  p_endereco        text default null,
  p_funcao          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Sessao ausente. Entre novamente.');
  end if;

  if btrim(coalesce(p_nome, '')) = '' then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Informe o nome completo.');
  end if;

  select m.id into v_id
    from public.membros m
   where m.user_id = v_uid
   limit 1;

  if v_id is null then
    return jsonb_build_object(
      'status', 'erro',
      'mensagem', 'Nao ha pre-cadastro aberto para esta conta.'
    );
  end if;

  begin
    update public.membros m
       set nome_completo     = btrim(p_nome),
           telefone         = nullif(btrim(coalesce(p_telefone, '')), ''),
           data_nascimento  = p_data_nascimento,
           sexo             = nullif(btrim(coalesce(p_sexo, '')), ''),
           endereco         = nullif(btrim(coalesce(p_endereco, '')), ''),
           funcao           = nullif(btrim(coalesce(p_funcao, '')), ''),
           cadastro_completo = true
     where m.id = v_id
       and m.user_id = v_uid;
  exception
    when others then
      return jsonb_build_object(
        'status', 'erro',
        'mensagem', 'Nao foi possivel salvar: ' || sqlerrm
      );
  end;

  return jsonb_build_object('status', 'ok', 'id', v_id, 'completo', true);
end;
$$;

comment on function public.completar_meu_cadastro(text, text, date, text, text, text) is
  'Fecha o pre-cadastro do usuario atual. So escreve na linha do proprio user_id.';


-- ============================================================================
-- 8) PERMISSOES DAS FUNCOES
-- ============================================================================
-- PUBLIC tem EXECUTE por padrao em qualquer funcao nova. anon nao deve
-- chamar nada disto: sem sessao, auth.uid() e nulo e a funcao nao faz nada,
-- mas nao ha motivo para deixar.
-- ============================================================================

revoke all on function public.entrar_no_membro()            from public, anon;
revoke all on function public.meu_membro()                 from public, anon;
revoke all on function public.completar_meu_cadastro(text, text, date, text, text, text) from public, anon;

grant execute on function public.entrar_no_membro()            to authenticated;
grant execute on function public.meu_membro()                 to authenticated;
grant execute on function public.completar_meu_cadastro(text, text, date, text, text, text) to authenticated;


-- ============================================================================
-- 9) CHECAGEM
-- ============================================================================
-- Deve retornar 0 linhas. Se o primeiro der > 0, dois membros com o mesmo
-- email estao em aberto e o login vai responder 'ambiguo' em vez de vincular.
-- Resolver pela secretaria antes de usar.
-- ============================================================================

-- 9.1) pre-cadastros abertos (o normal, sao os usuarios novos):
select count(*) as pre_cadastros_abertos
  from public.membros
 where cadastro_completo = false;

-- 9.2) emails duplicados em aberto: precisa dar zero
select public.email_normalizado(m.email) as email,
       count(*)                          as ocorrencias,
       array_agg(m.id)                   as ids
  from public.membros m
 where m.user_id is null
 group by 1
having count(*) > 1;

-- 9.3) contas sem pre-cadastro (viram a tela e sairam):
select p.id, p.email, p.nome
  from public.profiles p
  left join public.membros m on m.user_id = p.id
 where m.id is null;
