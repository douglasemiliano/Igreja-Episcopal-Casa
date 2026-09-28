-- ============================================================================
-- 20260928_atualizacao_cadastral.sql
--
-- Leva a pessoa para a tela de cadastro depois do login nos DOIS desfechos do
-- entrar_no_membro():
--
--   - o email bateu com um membro que ja existia  -> vincula, e mesmo assim
--     a tela aparece, porque um registro antigo pode estar sem telefone,
--     endereco ou data de nascimento;
--   - o email nao bateu com ninguem                -> abre pre-cadastro, e a
--     tela aparece para o preenchimento.
--
-- Migration separada de 20260927_vincular_membros.sql, e nao uma edicao dela,
-- porque pode ser que aquela ja tenha rodado. Tudo aqui e idempotente.
-- ============================================================================


-- ============================================================================
-- 1) MARCA DE "JA ATUALIZOU O CADASTRO"
-- ============================================================================
-- Sem esta coluna, "precisa da tela" seria verdadeiro para sempre e o
-- formulario cairia em todo login. `cadastro_completo` nao serve para isso:
-- o registro de um membro que a secretaria cadastrou ha anos ja vem completo,
-- e continua completo.
--
-- O que esta coluna responde e outra pergunta: "esta conta ja teve a chance de
-- conferir os proprios dados?". Uma vez respondida, nao se pergunta de novo.
-- ============================================================================

alter table public.membros
  add column if not exists cadastro_verificado_em timestamptz;

comment on column public.membros.cadastro_verificado_em is
  'Quando a conta linkeda confirmou os proprios dados. NULL = ainda nao passou pela tela.';


-- ============================================================================
-- 2) entrar_no_membro passa a dizer se a conta ja passou pela tela
-- ============================================================================
-- Sem isto o guard precisaria de uma segunda chamada (meu_membro) so para
-- saber disso, em toda navegacao.
-- ============================================================================

create or replace function public.entrar_no_membro()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_nome      text;
  v_id        uuid;
  v_nome_mem  text;
  v_completo  boolean;
  v_verificado timestamptz;
  v_qtd       integer;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Sessao ausente. Entre novamente.');
  end if;

  -- 2.1) Ja vinculado?
  select m.id, m.nome_completo, m.cadastro_completo, m.cadastro_verificado_em
    into v_id, v_nome_mem, v_completo, v_verificado
    from public.membros m
   where m.user_id = v_uid
   limit 1;

  if v_id is not null then
    return jsonb_build_object('status', 'vinculado',
                              'id', v_id,
                              'nome', v_nome_mem,
                              'completo', v_completo,
                              'verificado', v_verificado);
  end if;

  v_email := public.email_normalizado(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    return jsonb_build_object('status', 'sem_email');
  end if;

  -- 2.2) Bate com membro ja cadastrado?
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

    select m.nome_completo, m.cadastro_completo, m.cadastro_verificado_em
      into v_nome_mem, v_completo, v_verificado
      from public.membros m
     where m.id = v_id;

    -- cadastro_completo NAO e tocado: o registro continua como a secretaria o
    -- deixou. cadastro_verificado_em continua NULL, e e isso que manda a
    -- pessoa para a tela uma unica vez.
    return jsonb_build_object('status', 'vinculado',
                              'id', v_id,
                              'nome', v_nome_mem,
                              'completo', v_completo,
                              'verificado', v_verificado);
  end if;

  if v_qtd > 1 then
    return jsonb_build_object('status', 'ambiguo', 'quantidade', v_qtd);
  end if;

  -- 2.3) Nao bate com ninguem: abre pre-cadastro.
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
                            'completo', false,
                            'verificado', null);
end;
$$;


-- ============================================================================
-- 3) meu_membro devolve a marca
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
           'completo',    coalesce(m.cadastro_completo, false),
           'verificado',  m.cadastro_verificado_em
         )
    from public.membros m
   where m.user_id = auth.uid()
   limit 1;
$$;


-- ============================================================================
-- 4) completar_meu_cadastro tambem carimba a tela
-- ============================================================================
-- Os parametros nao mudam, entao quem chamou a versao anterior continua
-- funcionando. A unica novidade e a coluna.
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
      'mensagem', 'Nao ha cadastro vinculado a esta conta.'
    );
  end if;

  begin
    update public.membros m
       set nome_completo      = btrim(p_nome),
           telefone          = nullif(btrim(coalesce(p_telefone, '')), ''),
           data_nascimento   = p_data_nascimento,
           sexo              = nullif(btrim(coalesce(p_sexo, '')), ''),
           endereco          = nullif(btrim(coalesce(p_endereco, '')), ''),
           funcao            = nullif(btrim(coalesce(p_funcao, '')), ''),
           cadastro_completo = true,
           cadastro_verificado_em = now()
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


-- ============================================================================
-- 5) pular_atualizacao_cadastral
-- ============================================================================
-- Sair da tela sem preencher. Carimba a marca do mesmo jeito, senao ela
-- reaparece no proximo login e nao ha como escapar de uma tela obrigatoria.
--
-- O registro NAO e alterado: quem pular continua com o que a secretaria
-- cadastrou, e pode editar depois pelo /perfil.
-- ============================================================================

create or replace function public.pular_atualizacao_cadastral()
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

  select m.id into v_id
    from public.membros m
   where m.user_id = v_uid
   limit 1;

  if v_id is null then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Nao ha cadastro vinculado a esta conta.');
  end if;

  update public.membros m
     set cadastro_verificado_em = now()
   where m.id = v_id
     and m.user_id = v_uid;

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;


-- ============================================================================
-- 6) PERMISSOES DAS FUNCOES
-- ============================================================================

revoke all on function public.pular_atualizacao_cadastral() from public, anon;
grant  execute on function public.pular_atualizacao_cadastral() to authenticated;

-- As outras tres ja estavam com revoke/grant em 20260927_vincular_membros.sql,
-- e create or replace preserva os privilegios, mas repetir aqui deixa o
-- arquivo seguro de rodar sozinho.
revoke all on function public.entrar_no_membro()  from public, anon;
revoke all on function public.meu_membro()       from public, anon;
revoke all on function public.completar_meu_cadastro(text, text, date, text, text, text) from public, anon;

grant execute on function public.entrar_no_membro()  to authenticated;
grant execute on function public.meu_membro()       to authenticated;
grant execute on function public.completar_meu_cadastro(text, text, date, text, text, text) to authenticated;


-- ============================================================================
-- 7) CHECAGEM
-- ============================================================================

-- 7.1) Quantas contas ainda nao passaram pela tela. Deve cair depois das
--      primeiras pessoas completarem o cadastro.
select count(*) as aguardando_tela
  from public.membros m
  join public.profiles p on p.id = m.user_id
 where m.cadastro_verificado_em is null;

-- 7.2) Estas aqui TEM registro completo e ja foram avisadas. Se aparecer
--      alguma, o "pular" carimbou sem o cadastro_completo subir, o que seria
--      esperado num pre-cadastro abandonado e errado num membro da secretaria.
select m.nome_completo, m.email, m.cadastro_completo, m.cadastro_verificado_em
  from public.membros m
 where m.cadastro_completo
   and m.user_id is not null
   and m.cadastro_verificado_em is not null
 order by m.cadastro_verificado_em desc
 limit 10;
