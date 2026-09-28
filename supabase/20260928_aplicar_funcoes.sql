-- ============================================================================
-- 20260928_aplicar_funcoes.sql
--
-- SOMENTE AS FUNCOES do 20260928_atualizacao_cadastral.sql, isoladas.
--
-- Por que este arquivo existe: o 20260928 completo parou logo depois do
-- `alter table`, que é a primeira instrução dele. A coluna
-- `cadastro_verificado_em` foi criada, mas as funções não. O
-- `entrar_no_membro` que está no banco é a versão de 20260927, que não
-- devolve o campo `verificado` — e o app, ao ver esse campo ausente, entende
-- "esta conta nunca conferiu os próprios dados" e devolve a pessoa para a
-- tela de cadastro, para sempre.
--
-- COMO RODAR
-- ==========
-- NÃO rode o arquivo inteiro de uma vez se o seu runner reclamar de sintaxe.
-- Cada bloco abaixo é um statement independente e deve ser enviado como um
-- statement só.
--
-- No SQL Editor do Supabase Dashboard isso funciona: cole um bloco por vez e
-- execute. O editor entende dollar-quoting, então os corpos com $$ passam
-- inteiros.
--
-- Se o seu runner só aceita arquivos, rode este arquivo INTEIRO nele, e se
-- der erro de sintaxe me mande o erro: aí o problema é o runner e a solução é
-- outra (rodar pelo Dashboard).
--
-- As tres funcoes sao necessarias nesta ordem de importancia:
--   1. entrar_no_membro          -> sem ela, a tela trava em laco
--   2. completar_meu_cadastro    -> sem ela, o carimbo nao e gravado
--   3. pular_atualizacao_cadastral-> sem ela, o "Agora nao" nao funciona
-- A 1 e a 2 sao as que destravam. A 3 so faz falta se voce usa o botao de pular.
-- ============================================================================


-- ###########################################################################
-- FUNCAO 1 de 3: entrar_no_membro
-- Devolve o campo `verificado`. E a que quebra o laco.
-- ###########################################################################

create or replace function public.entrar_no_membro()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_nome       text;
  v_id         uuid;
  v_nome_mem   text;
  v_completo   boolean;
  v_verificado timestamptz;
  v_qtd        integer;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'erro',
                              'mensagem', 'Sessao ausente. Entre novamente.');
  end if;

  -- Ja vinculado?
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

  -- Bate com membro ja cadastrado?
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

  -- Nao bate com ninguem: abre pre-cadastro.
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


-- ###########################################################################
-- FUNCAO 2 de 3: meu_membro
-- Devolve `verificado` para a tela saber se ja passou por aqui.
-- ###########################################################################

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


-- ###########################################################################
-- FUNCAO 3 de 3: completar_meu_cadastro
-- Grava o carimbo de "ja passou por aqui".
-- ###########################################################################

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


-- ###########################################################################
-- FUNCAO 4 de 4: pular_atualizacao_cadastral
-- Carimba a marca sem alterar o registro. Necessaria para o botao "Agora nao".
-- ###########################################################################

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
-- PERMISSOES DAS FUNCOES
-- ============================================================================
-- create or replace PRESERVA os privilegios de uma funcao que ja existe, mas
-- nao concede em uma que nunca existiu. Nos dois casos o revoke/grant abaixo
-- deixa o estado certo, entao vale rodar.
-- ============================================================================

revoke all on function public.entrar_no_membro() from public, anon;
revoke all on function public.meu_membro() from public, anon;
revoke all on function public.pular_atualizacao_cadastral() from public, anon;
revoke all on function public.completar_meu_cadastro(text, text, date, text, text, text) from public, anon;

grant execute on function public.entrar_no_membro() to authenticated;
grant execute on function public.meu_membro() to authenticated;
grant execute on function public.pular_atualizacao_cadastral() to authenticated;
grant execute on function public.completar_meu_cadastro(text, text, date, text, text, text) to authenticated;


-- ============================================================================
-- CHECAGEM: tem que voltar 'OK' nas quatro
-- ============================================================================
select proname as funcao,
       case when prosrc ilike '%cadastro_verificado_em%' then 'OK (versao nova)'
            else 'ANTIGA' end as versao
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('entrar_no_membro', 'meu_membro',
                     'completar_meu_cadastro', 'pular_atualizacao_cadastral')
 order by proname;
