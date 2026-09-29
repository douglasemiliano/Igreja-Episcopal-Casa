


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."caixas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" DEFAULT 'aberto'::"text" NOT NULL,
    "aberto_por" "uuid" NOT NULL,
    "aberto_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valor_abertura" numeric DEFAULT 0 NOT NULL,
    "observacoes_abertura" "text",
    "fechado_por" "uuid",
    "fechado_em" timestamp with time zone,
    "valor_fechamento_informado" numeric,
    "valor_esperado" numeric,
    "diferenca" numeric,
    "observacoes_fechamento" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reaberto_em" timestamp with time zone,
    "reaberto_por" "uuid",
    "observacoes_reabertura" "text",
    "vezes_reaberto" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "caixas_fechamento_consistente" CHECK (((("status" = 'aberto'::"text") AND ("fechado_em" IS NULL) AND ("fechado_por" IS NULL)) OR (("status" = 'fechado'::"text") AND ("fechado_em" IS NOT NULL) AND ("fechado_por" IS NOT NULL)))),
    CONSTRAINT "caixas_status_check" CHECK (("status" = ANY (ARRAY['aberto'::"text", 'fechado'::"text"]))),
    CONSTRAINT "caixas_valor_abertura_check" CHECK (("valor_abertura" >= (0)::numeric)),
    CONSTRAINT "caixas_valor_fechamento_informado_check" CHECK (("valor_fechamento_informado" >= (0)::numeric))
);


ALTER TABLE "public"."caixas" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."abrir_caixa"("p_valor_abertura" numeric, "p_observacoes" "text" DEFAULT NULL::"text") RETURNS "public"."caixas"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_caixa public.caixas;
begin
  if not public.tem_perfil(array['administrador', 'tesouraria']::text[]) then
    raise exception 'Apenas administrador ou tesouraria podem abrir o caixa.';
  end if;

  if exists (select 1 from public.caixas where status = 'aberto') then
    raise exception 'Já existe um caixa aberto.';
  end if;

  insert into public.caixas (aberto_por, valor_abertura, observacoes_abertura)
  values (auth.uid(), p_valor_abertura, p_observacoes)
  returning * into v_caixa;

  return v_caixa;
end;
$$;


ALTER FUNCTION "public"."abrir_caixa"("p_valor_abertura" numeric, "p_observacoes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atualizar_meu_foto"("nova_foto" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.profiles
  set foto = nova_foto,
      atualizado_em = now()
  where id = auth.uid();
$$;


ALTER FUNCTION "public"."atualizar_meu_foto"("nova_foto" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atualizar_meu_nome"("novo_nome" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if novo_nome is null or char_length(trim(novo_nome)) < 2 then
    raise exception 'Nome inválido';
  end if;

  update public.profiles
  set nome = trim(novo_nome),
      atualizado_em = now()
  where id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."atualizar_meu_nome"("novo_nome" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atualizar_meu_perfil"("p_nome" "text", "p_telefone" "text" DEFAULT NULL::"text", "p_data_nascimento" "date" DEFAULT NULL::"date", "p_sexo" "text" DEFAULT NULL::"text", "p_endereco" "text" DEFAULT NULL::"text", "p_funcao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    -- Não é erro de verdade: é quem entrou no app sem ter conta na lista de
    -- membros (um administrador, por exemplo). A mensagem diz isso, para a tela
    -- não mostrar "não foi possível salvar" para algo que é o estado normal.
    return jsonb_build_object(
      'status', 'sem_vinculo',
      'mensagem', 'Esta conta ainda nao tem um cadastro de membro vinculado.'
    );
  end if;

  begin
    update public.membros m
       set nome_completo    = btrim(p_nome),
           telefone        = nullif(btrim(coalesce(p_telefone, '')), ''),
           data_nascimento = p_data_nascimento,
           sexo            = nullif(btrim(coalesce(p_sexo, '')), ''),
           endereco        = nullif(btrim(coalesce(p_endereco, '')), ''),
           funcao          = nullif(btrim(coalesce(p_funcao, '')), '')
     where m.id = v_id
       and m.user_id = v_uid;
  exception
    when others then
      return jsonb_build_object(
        'status', 'erro',
        'mensagem', 'Nao foi possivel salvar: ' || sqlerrm
      );
  end;

  -- Espelho em `profiles`. O cabeçalho e a central leem o nome de lá, então sem
  -- isto a pessoa corrigiria o próprio nome nesta tela e veria o nome antigo
  -- no topo do app, sem explicação. Só o nome: os demais campos de `membros`
  -- não têm cópia em `profiles` e não precisam de espelho.
  begin
    update public.profiles p
       set nome = btrim(p_nome)
     where p.id = v_uid;
  exception
    when others then
      -- Não desfaz o que já foi salvo em `membros`. O cadastro do membro é a
      -- fonte da verdade agora; o espelho é cosmético e pode ser corrigido
      -- depois. Falhar aqui em vez de engolir em silêncio, para não virar
      -- mistério de "salvei e o cabeçalho não mudou".
      return jsonb_build_object(
        'status', 'ok',
        'id', v_id,
        'membro_salvo', true,
        'perfil_sincronizado', false,
        'mensagem', 'Cadastro salvo, mas o nome do cabecalho nao foi atualizado.'
      );
  end;

  return jsonb_build_object('status', 'ok', 'id', v_id, 'perfil_sincronizado', true);
end;
$$;


ALTER FUNCTION "public"."atualizar_meu_perfil"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."completar_meu_cadastro"("p_nome" "text", "p_telefone" "text" DEFAULT NULL::"text", "p_data_nascimento" "date" DEFAULT NULL::"date", "p_sexo" "text" DEFAULT NULL::"text", "p_endereco" "text" DEFAULT NULL::"text", "p_funcao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."completar_meu_cadastro"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."conceder_permissao"("alvo_chave" "text", "alvo_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.tem_perfil(array['administrador']) then
    raise exception 'Somente administrador gerencia permissoes';
  end if;

  if exists (select 1 from public.permissoes where chave = alvo_chave and reservada) then
    raise exception 'A permissao % e reservada e nao pode ser concedida', alvo_chave;
  end if;

  if not exists (select 1 from public.permissoes where chave = alvo_chave) then
    raise exception 'Permissao desconhecida: %', alvo_chave;
  end if;

  insert into public.permissoes_roles (chave, role)
  values (alvo_chave, alvo_role)
  on conflict do nothing;
end $$;


ALTER FUNCTION "public"."conceder_permissao"("alvo_chave" "text", "alvo_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."email_normalizado"("valor" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select lower(btrim(coalesce(valor, '')));
$$;


ALTER FUNCTION "public"."email_normalizado"("valor" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."entrar_no_membro"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."entrar_no_membro"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."excluir_membro_e_conta"("p_membro_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."excluir_membro_e_conta"("p_membro_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fechar_caixa"("p_valor_fechamento" numeric, "p_observacoes" "text" DEFAULT NULL::"text") RETURNS "public"."caixas"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_caixa_id uuid;
  v_total_dinheiro numeric;
  v_total_saidas numeric;
  v_caixa public.caixas;
begin
  if not public.tem_perfil(array['administrador', 'tesouraria']::text[]) then
    raise exception 'Apenas administrador ou tesouraria podem fechar o caixa.';
  end if;

  select id into v_caixa_id
  from public.caixas
  where status = 'aberto';

  if v_caixa_id is null then
    raise exception 'Não há caixa aberto para fechar.';
  end if;

  -- só entradas em dinheiro entram na conferência física do caixa
  select coalesce(sum(total), 0) into v_total_dinheiro
  from public.vendas_arrecadacao
  where caixa_id = v_caixa_id
    and status = 'pago'
    and forma_pagamento = 'dinheiro';

  -- o que saiu da gaveta para comprar, descontando o troco que voltou
  select coalesce(sum(valor_efetivo), 0) into v_total_saidas
  from public.saidas_caixa
  where caixa_id = v_caixa_id;

  update public.caixas
  set status = 'fechado',
      fechado_por = auth.uid(),
      fechado_em = now(),
      valor_fechamento_informado = p_valor_fechamento,
      valor_esperado = valor_abertura + v_total_dinheiro - v_total_saidas,
      diferenca = p_valor_fechamento - (valor_abertura + v_total_dinheiro - v_total_saidas),
      observacoes_fechamento = p_observacoes
  where id = v_caixa_id
  returning * into v_caixa;

  return v_caixa;
end;
$$;


ALTER FUNCTION "public"."fechar_caixa"("p_valor_fechamento" numeric, "p_observacoes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  role_lista text[];
begin
  -- metadata pode trazer 'role' (string) ou 'roles' (array)
  if new.raw_user_meta_data ? 'roles' then
    select coalesce(array_agg(value::text), array['membro']::text[])
      into role_lista
      from jsonb_array_elements_text(new.raw_user_meta_data->'roles') as value;
  elsif coalesce(new.raw_user_meta_data->>'role', '') <> '' then
    role_lista := array[new.raw_user_meta_data->>'role'];
  else
    role_lista := array['membro'];
  end if;

  -- normaliza 'leitor' -> 'membro'
  select coalesce(array_agg(
    case when r = 'leitor' then 'membro' else r end
  order by r), array['membro']::text[])
    into role_lista
    from unnest(role_lista) as r;

  insert into public.profiles (id, roles, nome, email)
  values (
    new.id,
    role_lista,
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      split_part(coalesce(new.email, 'usuario'), '@', 1)
    ),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        nome  = coalesce(public.profiles.nome, excluded.nome);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.tem_perfil(array['administrador']::text[]);
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lider_da_celula"("alvo_celula" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
      from public.celula_membros cm
      join public.membros m on m.id = cm.membro_id
     where cm.celula_id = alvo_celula
       and cm.papel     = 'lider'
       and m.user_id    = auth.uid()
  );
$$;


ALTER FUNCTION "public"."lider_da_celula"("alvo_celula" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_permissao_alterada"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into public.permissoes_auditoria (chave, role, operacao, feito_por)
    values (new.chave, new.role, 'conceder', auth.uid());
    return new;
  end if;

  insert into public.permissoes_auditoria (chave, role, operacao, feito_por)
  values (old.chave, old.role, 'revogar', auth.uid());
  return old;
end;
$$;


ALTER FUNCTION "public"."marcar_permissao_alterada"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_saida_editada"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.atualizado_por := auth.uid();
  new.atualizado_em := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."marcar_saida_editada"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."meu_membro"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."meu_membro"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."minhas_celulas"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',    c.id,
               'nome',  c.nome,
               'papel', cm.papel
             )
             order by c.nome
           ),
           '[]'::jsonb
         )
    from public.celula_membros cm
    join public.celulas c on c.id = cm.celula_id
    join public.membros m on m.id = cm.membro_id
   where m.user_id = auth.uid()
     and c.ativa;
$$;


ALTER FUNCTION "public"."minhas_celulas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."minhas_permissoes"() RETURNS "text"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(array_agg(p.chave), '{}'::text[])
  from public.permissoes p
  where public.pode(p.chave);
$$;


ALTER FUNCTION "public"."minhas_permissoes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."papeis_que_formam_qualquer_celula"() RETURNS "text"[]
    LANGUAGE "sql" STABLE
    AS $$
  select array['administrador','pastor','secretaria']::text[];
$$;


ALTER FUNCTION "public"."papeis_que_formam_qualquer_celula"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pode"("chave_procurada" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    -- Bypass do administrador: hardcoded, não revogável, e por isso não
    -- precisa de proteção contra lockout.
    public.tem_perfil(array['administrador']::text[])
    or exists (
      select 1
      from public.permissoes p
      join public.permissoes_roles pr on pr.chave = p.chave
      join public.profiles pf on pf.id = auth.uid()
      where p.chave = chave_procurada
        and not p.reservada
        and pr.role = any (pf.roles)
    );
$$;


ALTER FUNCTION "public"."pode"("chave_procurada" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pode_formar_qualquer_celula"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.pode('vincular_membros_celula')
     and public.tem_perfil(public.papeis_que_formam_qualquer_celula());
$$;


ALTER FUNCTION "public"."pode_formar_qualquer_celula"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pode_vincular_esta_celula"("alvo_celula" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.lider_da_celula(alvo_celula)
      or public.pode_formar_qualquer_celula();
$$;


ALTER FUNCTION "public"."pode_vincular_esta_celula"("alvo_celula" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pular_atualizacao_cadastral"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."pular_atualizacao_cadastral"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reabrir_caixa"("p_caixa_id" "uuid", "p_observacoes" "text" DEFAULT NULL::"text") RETURNS "public"."caixas"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."reabrir_caixa"("p_caixa_id" "uuid", "p_observacoes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revogar_permissao"("alvo_chave" "text", "alvo_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.tem_perfil(array['administrador']) then
    raise exception 'Somente administrador gerencia permissoes';
  end if;

  delete from public.permissoes_roles
  where chave = alvo_chave and role = alvo_role;
end $$;


ALTER FUNCTION "public"."revogar_permissao"("alvo_chave" "text", "alvo_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."role_em"("variaveis" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.tem_perfil(variaveis);
$$;


ALTER FUNCTION "public"."role_em"("variaveis" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tem_perfil"("perfis" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and profiles.roles && perfis
  );
$$;


ALTER FUNCTION "public"."tem_perfil"("perfis" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tocar_atualizado_em"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."tocar_atualizado_em"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vincula_venda_ao_caixa_aberto"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caixa_id uuid;
BEGIN
  SELECT id INTO v_caixa_id FROM public.caixas WHERE status = 'aberto';

  IF v_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Não há caixa aberto. Abra o caixa antes de registrar vendas.';
  END IF;

  NEW.caixa_id := v_caixa_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."vincula_venda_ao_caixa_aberto"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agenda_igreja" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "titulo" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "inicio" timestamp with time zone NOT NULL,
    "fim" timestamp with time zone,
    "local" "text",
    "responsaveis" "text",
    "observacoes" "text",
    "criado_por" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "imagem_url" "text",
    CONSTRAINT "agenda_igreja_imagem_url_check" CHECK ((("imagem_url" IS NULL) OR ("imagem_url" ~ '^https://[^/]+/storage/v1/object/public/postagens/'::"text"))),
    CONSTRAINT "agenda_igreja_tipo_check" CHECK (("tipo" = ANY (ARRAY['culto'::"text", 'reuniao'::"text", 'batismo'::"text", 'casamento'::"text", 'arrecadacao'::"text", 'escala'::"text", 'outro'::"text"])))
);


ALTER TABLE "public"."agenda_igreja" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."celula_membros" (
    "celula_id" "uuid" NOT NULL,
    "membro_id" "uuid" NOT NULL,
    "papel" "text" DEFAULT 'membro'::"text" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "celula_membros_papel" CHECK (("papel" = ANY (ARRAY['membro'::"text", 'lider'::"text"])))
);


ALTER TABLE "public"."celula_membros" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."celulas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "descricao" "text",
    "dia_semana" "text",
    "local" "text",
    "horario" time without time zone,
    "ativa" boolean DEFAULT true NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."celulas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."confirmacoes_membros" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "membro_id" "uuid",
    "data_confirmacao" "date" DEFAULT "now"() NOT NULL,
    "oficiante" "text",
    "observacoes" "text"
);


ALTER TABLE "public"."confirmacoes_membros" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feed_publicacoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "autor_id" "uuid",
    "conteudo" "text" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "imagem_url" "text",
    CONSTRAINT "feed_publicacoes_conteudo_check" CHECK (("char_length"(TRIM(BOTH FROM "conteudo")) > 0)),
    CONSTRAINT "feed_publicacoes_imagem_url_check" CHECK ((("imagem_url" IS NULL) OR ("imagem_url" ~ '^https://[^/]+/storage/v1/object/public/postagens/'::"text")))
);


ALTER TABLE "public"."feed_publicacoes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."itens_venda_arrecadacao" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venda_id" "uuid" NOT NULL,
    "categoria" "text" NOT NULL,
    "descricao" "text" NOT NULL,
    "quantidade" integer DEFAULT 1 NOT NULL,
    "valor_unitario" numeric(10,2) NOT NULL,
    "valor_total" numeric(10,2) GENERATED ALWAYS AS ((("quantidade")::numeric * "valor_unitario")) STORED,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "itens_venda_arrecadacao_categoria_check" CHECK (("categoria" = ANY (ARRAY['bazar'::"text", 'hamburgada'::"text", 'feijoada'::"text"]))),
    CONSTRAINT "itens_venda_arrecadacao_quantidade_check" CHECK (("quantidade" > 0)),
    CONSTRAINT "itens_venda_arrecadacao_valor_unitario_check" CHECK (("valor_unitario" > (0)::numeric))
);


ALTER TABLE "public"."itens_venda_arrecadacao" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lecionario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tempo" "text",
    "dia" "date",
    "oracoes" "jsonb",
    "leituras" "jsonb",
    "nome" "text",
    "ano_liturgico" "text"
);


ALTER TABLE "public"."lecionario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."livros" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tipo" "text" NOT NULL,
    "numero_livro" integer NOT NULL,
    "criado_em" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "livros_tipo_check" CHECK (("tipo" = ANY (ARRAY['batismo'::"text", 'confirmacao'::"text", 'casamento'::"text"])))
);


ALTER TABLE "public"."livros" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."membros" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome_completo" "text" NOT NULL,
    "email" "text",
    "telefone" "text",
    "data_nascimento" "date",
    "sexo" "text",
    "endereco" "text",
    "funcao" "text",
    "data_entrada" "date",
    "ativo" boolean DEFAULT true,
    "criado_em" timestamp without time zone DEFAULT "now"(),
    "atualizado_em" timestamp without time zone DEFAULT "now"(),
    "user_id" "uuid",
    "cadastro_completo" boolean DEFAULT false NOT NULL,
    "cadastro_verificado_em" timestamp with time zone
);


ALTER TABLE "public"."membros" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissoes" (
    "chave" "text" NOT NULL,
    "rotulo" "text" NOT NULL,
    "descricao" "text",
    "categoria" "text" DEFAULT 'Geral'::"text" NOT NULL,
    "ordenacao" integer DEFAULT 100 NOT NULL,
    "reservada" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."permissoes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissoes_auditoria" (
    "id" bigint NOT NULL,
    "chave" "text" NOT NULL,
    "role" "text" NOT NULL,
    "operacao" "text" NOT NULL,
    "feito_por" "uuid",
    "feito_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "permissoes_auditoria_operacao_check" CHECK (("operacao" = ANY (ARRAY['conceder'::"text", 'revogar'::"text"])))
);


ALTER TABLE "public"."permissoes_auditoria" OWNER TO "postgres";


ALTER TABLE "public"."permissoes_auditoria" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."permissoes_auditoria_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."permissoes_roles" (
    "chave" "text" NOT NULL,
    "role" "text" NOT NULL
);


ALTER TABLE "public"."permissoes_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "nome" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text",
    "roles" "text"[] DEFAULT ARRAY['membro'::"text"] NOT NULL,
    "foto" "text",
    CONSTRAINT "profiles_roles_check" CHECK ((("roles" <@ ARRAY['administrador'::"text", 'secretaria'::"text", 'caixa'::"text", 'tesouraria'::"text", 'pastor'::"text", 'lider'::"text", 'membro'::"text"]) AND ("cardinality"("roles") > 0)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."registros_batismo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "numero_registro" bigint NOT NULL,
    "nome_irmao" "text" NOT NULL,
    "data_nascimento" "date",
    "nacionalidade" "text",
    "pai" "text",
    "mae" "text",
    "padrinho" "text",
    "madrinha" "text",
    "data_batismo" "date",
    "pastor" "text",
    "secretario" "text",
    "livro" "text",
    "pagina" "text",
    "rua" "text",
    "numero_endereco" "text",
    "complemento" "text",
    "bairro" "text",
    "cidade" "text",
    "estado" "text",
    "cep" "text",
    "pais" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "membro_id" "uuid"
);


ALTER TABLE "public"."registros_batismo" OWNER TO "postgres";


ALTER TABLE "public"."registros_batismo" ALTER COLUMN "numero_registro" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."registros_batismo_numero_registro_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."saidas_caixa" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "caixa_id" "uuid" NOT NULL,
    "valor" numeric(12,2) NOT NULL,
    "troco" numeric(12,2) DEFAULT 0 NOT NULL,
    "valor_efetivo" numeric(12,2) GENERATED ALWAYS AS (("valor" - "troco")) STORED,
    "motivo" "text" NOT NULL,
    "criado_por" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_por" "uuid",
    "atualizado_em" timestamp with time zone,
    CONSTRAINT "saidas_caixa_check" CHECK ((("troco" >= (0)::numeric) AND ("troco" <= "valor"))),
    CONSTRAINT "saidas_caixa_valor_check" CHECK (("valor" > (0)::numeric))
);


ALTER TABLE "public"."saidas_caixa" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendas_arrecadacao" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "membro_id" "uuid",
    "criado_por" "uuid",
    "forma_pagamento" "text" NOT NULL,
    "status" "text" DEFAULT 'pago'::"text" NOT NULL,
    "total" numeric(10,2) DEFAULT 0 NOT NULL,
    "data_venda" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_pagamento" timestamp with time zone,
    "observacoes" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "caixa_id" "uuid",
    CONSTRAINT "fiado_deve_ter_membro" CHECK ((("forma_pagamento" <> 'fiado'::"text") OR ("membro_id" IS NOT NULL))),
    CONSTRAINT "vendas_arrecadacao_forma_pagamento_check" CHECK (("forma_pagamento" = ANY (ARRAY['pix'::"text", 'debito'::"text", 'credito'::"text", 'dinheiro'::"text", 'fiado'::"text"]))),
    CONSTRAINT "vendas_arrecadacao_status_check" CHECK (("status" = ANY (ARRAY['pago'::"text", 'pendente'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "vendas_arrecadacao_total_check" CHECK (("total" >= (0)::numeric))
);


ALTER TABLE "public"."vendas_arrecadacao" OWNER TO "postgres";


ALTER TABLE ONLY "public"."lecionario"
    ADD CONSTRAINT "Lecionario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agenda_igreja"
    ADD CONSTRAINT "agenda_igreja_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caixas"
    ADD CONSTRAINT "caixas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."celula_membros"
    ADD CONSTRAINT "celula_membros_pkey" PRIMARY KEY ("celula_id", "membro_id");



ALTER TABLE ONLY "public"."celulas"
    ADD CONSTRAINT "celulas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."confirmacoes_membros"
    ADD CONSTRAINT "confirmacoes_membros_membro_id_key" UNIQUE ("membro_id");



ALTER TABLE ONLY "public"."confirmacoes_membros"
    ADD CONSTRAINT "confirmacoes_membros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feed_publicacoes"
    ADD CONSTRAINT "feed_publicacoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."itens_venda_arrecadacao"
    ADD CONSTRAINT "itens_venda_arrecadacao_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lecionario"
    ADD CONSTRAINT "lecionario_dia_key" UNIQUE ("dia");



ALTER TABLE ONLY "public"."livros"
    ADD CONSTRAINT "livros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."membros"
    ADD CONSTRAINT "membros_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."membros"
    ADD CONSTRAINT "membros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissoes_auditoria"
    ADD CONSTRAINT "permissoes_auditoria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissoes"
    ADD CONSTRAINT "permissoes_pkey" PRIMARY KEY ("chave");



ALTER TABLE ONLY "public"."permissoes_roles"
    ADD CONSTRAINT "permissoes_roles_pkey" PRIMARY KEY ("chave", "role");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."registros_batismo"
    ADD CONSTRAINT "registros_batismo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saidas_caixa"
    ADD CONSTRAINT "saidas_caixa_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendas_arrecadacao"
    ADD CONSTRAINT "vendas_arrecadacao_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "caixas_unico_aberto" ON "public"."caixas" USING "btree" ("status") WHERE ("status" = 'aberto'::"text");



CREATE INDEX "celula_membros_celula_idx" ON "public"."celula_membros" USING "btree" ("celula_id");



CREATE UNIQUE INDEX "celula_membros_membro_unico" ON "public"."celula_membros" USING "btree" ("membro_id");



CREATE INDEX "celulas_nome_idx" ON "public"."celulas" USING "btree" ("nome");



CREATE INDEX "feed_publicacoes_criado_em_idx" ON "public"."feed_publicacoes" USING "btree" ("criado_em" DESC);



CREATE UNIQUE INDEX "idx_membros_email_normalizado" ON "public"."membros" USING "btree" ("lower"("btrim"(COALESCE("email", ''::"text"))));



CREATE UNIQUE INDEX "idx_membros_user_id_uniq" ON "public"."membros" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "itens_venda_arrecadacao_categoria_idx" ON "public"."itens_venda_arrecadacao" USING "btree" ("categoria");



CREATE INDEX "itens_venda_arrecadacao_venda_idx" ON "public"."itens_venda_arrecadacao" USING "btree" ("venda_id");



CREATE INDEX "permissoes_auditoria_feito_em_idx" ON "public"."permissoes_auditoria" USING "btree" ("feito_em" DESC);



CREATE INDEX "permissoes_roles_role_idx" ON "public"."permissoes_roles" USING "btree" ("role");



CREATE INDEX "profiles_roles_idx" ON "public"."profiles" USING "gin" ("roles");



CREATE INDEX "saidas_caixa_caixa_idx" ON "public"."saidas_caixa" USING "btree" ("caixa_id");



CREATE INDEX "vendas_arrecadacao_data_idx" ON "public"."vendas_arrecadacao" USING "btree" ("data_venda" DESC);



CREATE INDEX "vendas_arrecadacao_forma_pagamento_idx" ON "public"."vendas_arrecadacao" USING "btree" ("forma_pagamento");



CREATE INDEX "vendas_arrecadacao_membro_idx" ON "public"."vendas_arrecadacao" USING "btree" ("membro_id");



CREATE INDEX "vendas_arrecadacao_status_idx" ON "public"."vendas_arrecadacao" USING "btree" ("status");



CREATE OR REPLACE TRIGGER "feed_publicacoes_atualizado_em" BEFORE UPDATE ON "public"."feed_publicacoes" FOR EACH ROW EXECUTE FUNCTION "public"."tocar_atualizado_em"();



CREATE OR REPLACE TRIGGER "permissoes_roles_marca_alteracao" AFTER INSERT OR DELETE ON "public"."permissoes_roles" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_permissao_alterada"();



CREATE OR REPLACE TRIGGER "saidas_caixa_marca_edicao" BEFORE UPDATE ON "public"."saidas_caixa" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_saida_editada"();



CREATE OR REPLACE TRIGGER "trg_vincula_venda_ao_caixa" BEFORE INSERT ON "public"."vendas_arrecadacao" FOR EACH ROW EXECUTE FUNCTION "public"."vincula_venda_ao_caixa_aberto"();



ALTER TABLE ONLY "public"."agenda_igreja"
    ADD CONSTRAINT "agenda_igreja_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caixas"
    ADD CONSTRAINT "caixas_aberto_por_fkey" FOREIGN KEY ("aberto_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."caixas"
    ADD CONSTRAINT "caixas_fechado_por_fkey" FOREIGN KEY ("fechado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."caixas"
    ADD CONSTRAINT "caixas_reaberto_por_fkey" FOREIGN KEY ("reaberto_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."celula_membros"
    ADD CONSTRAINT "celula_membros_celula_id_fkey" FOREIGN KEY ("celula_id") REFERENCES "public"."celulas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."celula_membros"
    ADD CONSTRAINT "celula_membros_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "public"."membros"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."confirmacoes_membros"
    ADD CONSTRAINT "confirmacoes_membros_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "public"."membros"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feed_publicacoes"
    ADD CONSTRAINT "feed_publicacoes_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."itens_venda_arrecadacao"
    ADD CONSTRAINT "itens_venda_arrecadacao_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas_arrecadacao"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."membros"
    ADD CONSTRAINT "membros_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."permissoes_auditoria"
    ADD CONSTRAINT "permissoes_auditoria_feito_por_fkey" FOREIGN KEY ("feito_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."permissoes_roles"
    ADD CONSTRAINT "permissoes_roles_chave_fkey" FOREIGN KEY ("chave") REFERENCES "public"."permissoes"("chave") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."registros_batismo"
    ADD CONSTRAINT "registros_batismo_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "public"."membros"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."saidas_caixa"
    ADD CONSTRAINT "saidas_caixa_atualizado_por_fkey" FOREIGN KEY ("atualizado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."saidas_caixa"
    ADD CONSTRAINT "saidas_caixa_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "public"."caixas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saidas_caixa"
    ADD CONSTRAINT "saidas_caixa_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendas_arrecadacao"
    ADD CONSTRAINT "vendas_arrecadacao_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "public"."caixas"("id");



ALTER TABLE ONLY "public"."vendas_arrecadacao"
    ADD CONSTRAINT "vendas_arrecadacao_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendas_arrecadacao"
    ADD CONSTRAINT "vendas_arrecadacao_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "public"."membros"("id") ON DELETE SET NULL;



CREATE POLICY "Admin e pastor atualizam perfis" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("public"."pode"('gerenciar_usuarios'::"text") AND ("public"."is_admin"() OR ((NOT ("roles" && ARRAY['administrador'::"text"])) AND ("id" <> "auth"."uid"()))))) WITH CHECK (("public"."pode"('gerenciar_usuarios'::"text") AND ("public"."is_admin"() OR ((NOT ("roles" && ARRAY['administrador'::"text"])) AND ("id" <> "auth"."uid"())))));



CREATE POLICY "Administrador e líder publicam no feed" ON "public"."feed_publicacoes" FOR INSERT TO "authenticated" WITH CHECK (("public"."pode"('publicar_publicacao'::"text") AND ("autor_id" = "auth"."uid"())));



CREATE POLICY "Administrador le a auditoria de permissoes" ON "public"."permissoes_auditoria" FOR SELECT TO "authenticated" USING ("public"."tem_perfil"(ARRAY['administrador'::"text"]));



CREATE POLICY "Administração atualiza livros" ON "public"."livros" FOR UPDATE TO "authenticated" USING ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"])) WITH CHECK ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"]));



CREATE POLICY "Administração atualiza membros" ON "public"."membros" FOR UPDATE TO "authenticated" USING ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"])) WITH CHECK ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"]));



CREATE POLICY "Administração atualiza registros de batismo" ON "public"."registros_batismo" FOR UPDATE TO "authenticated" USING ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"])) WITH CHECK ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"]));



CREATE POLICY "Administração cadastra livros" ON "public"."livros" FOR INSERT TO "authenticated" WITH CHECK ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"]));



CREATE POLICY "Administração cadastra membros" ON "public"."membros" FOR INSERT TO "authenticated" WITH CHECK ("public"."pode"('cadastrar_membros'::"text"));



CREATE POLICY "Administração cadastra registros de batismo" ON "public"."registros_batismo" FOR INSERT TO "authenticated" WITH CHECK ("public"."pode"('registrar_batismo'::"text"));



CREATE POLICY "Administração exclui livros" ON "public"."livros" FOR DELETE TO "authenticated" USING ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"]));



CREATE POLICY "Administração exclui registros de batismo" ON "public"."registros_batismo" FOR DELETE TO "authenticated" USING ("public"."tem_perfil"(ARRAY['administrador'::"text", 'secretaria'::"text"]));



CREATE POLICY "Allow delete for authenticated users" ON "public"."lecionario" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Allow insert for authenticated users" ON "public"."lecionario" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Allow read for anyone" ON "public"."lecionario" FOR SELECT USING (true);



CREATE POLICY "Allow update for authenticated users" ON "public"."lecionario" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Autenticados consultam celula_membros" ON "public"."celula_membros" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Autenticados consultam celulas" ON "public"."celulas" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Autenticados consultam permissoes" ON "public"."permissoes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Autenticados consultam permissoes_roles" ON "public"."permissoes_roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Autor edita a própria publicação" ON "public"."feed_publicacoes" FOR UPDATE TO "authenticated" USING (("autor_id" = "auth"."uid"())) WITH CHECK (("autor_id" = "auth"."uid"()));



CREATE POLICY "Autor, administrador e pastor removem publicação" ON "public"."feed_publicacoes" FOR DELETE TO "authenticated" USING ((("autor_id" = "auth"."uid"()) OR "public"."pode"('excluir_publicacao'::"text")));



CREATE POLICY "Editar evento" ON "public"."agenda_igreja" FOR UPDATE TO "authenticated" USING ("public"."pode"('editar_evento'::"text")) WITH CHECK ("public"."pode"('editar_evento'::"text"));



CREATE POLICY "Enable delete for users based on user_id" ON "public"."confirmacoes_membros" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."confirmacoes_membros" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."membros" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable read access for all users" ON "public"."confirmacoes_membros" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."membros" FOR SELECT USING (true);



CREATE POLICY "Excluir evento" ON "public"."agenda_igreja" FOR DELETE TO "authenticated" USING ("public"."pode"('excluir_evento'::"text"));



CREATE POLICY "Perfis gerenciam agenda" ON "public"."agenda_igreja" TO "authenticated" USING ("public"."role_em"(ARRAY['administrador'::"text", 'secretaria'::"text", 'pastor'::"text"])) WITH CHECK ("public"."role_em"(ARRAY['administrador'::"text", 'secretaria'::"text", 'pastor'::"text"]));



CREATE POLICY "Publicar evento" ON "public"."agenda_igreja" FOR INSERT TO "authenticated" WITH CHECK ("public"."pode"('publicar_evento'::"text"));



CREATE POLICY "Quem forma a celula insere membros" ON "public"."celula_membros" FOR INSERT TO "authenticated" WITH CHECK ("public"."pode_vincular_esta_celula"("celula_id"));



CREATE POLICY "Quem forma a celula promove membros" ON "public"."celula_membros" FOR UPDATE TO "authenticated" USING ("public"."pode_vincular_esta_celula"("celula_id")) WITH CHECK ("public"."pode_vincular_esta_celula"("celula_id"));



CREATE POLICY "Quem forma a celula remove membros" ON "public"."celula_membros" FOR DELETE TO "authenticated" USING ("public"."pode_vincular_esta_celula"("celula_id"));



CREATE POLICY "Quem gerencia celulas apaga celulas" ON "public"."celulas" FOR DELETE TO "authenticated" USING ("public"."pode"('gerenciar_celulas'::"text"));



CREATE POLICY "Quem gerencia celulas atualiza celulas" ON "public"."celulas" FOR UPDATE TO "authenticated" USING ("public"."pode"('gerenciar_celulas'::"text")) WITH CHECK ("public"."pode"('gerenciar_celulas'::"text"));



CREATE POLICY "Quem gerencia celulas insere celulas" ON "public"."celulas" FOR INSERT TO "authenticated" WITH CHECK ("public"."pode"('gerenciar_celulas'::"text"));



CREATE POLICY "Quem pode cadastrar membros cadastra membros" ON "public"."membros" FOR INSERT TO "authenticated" WITH CHECK ("public"."pode"('cadastrar_membros'::"text"));



CREATE POLICY "Quem pode excluir membros apaga membros" ON "public"."membros" FOR DELETE TO "authenticated" USING ("public"."pode"('excluir_membros'::"text"));



CREATE POLICY "Todos autenticados leem o feed" ON "public"."feed_publicacoes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Todos leem agenda" ON "public"."agenda_igreja" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados atualizam itens" ON "public"."itens_venda_arrecadacao" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Usuários autenticados atualizam vendas" ON "public"."vendas_arrecadacao" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Usuários autenticados consultam agenda" ON "public"."agenda_igreja" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados consultam itens" ON "public"."itens_venda_arrecadacao" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados consultam livros" ON "public"."livros" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados consultam membros" ON "public"."membros" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados consultam perfis" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados consultam registros de batismo" ON "public"."registros_batismo" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados consultam vendas" ON "public"."vendas_arrecadacao" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados criam itens" ON "public"."itens_venda_arrecadacao" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Usuários autenticados criam vendas" ON "public"."vendas_arrecadacao" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Usuários autenticados excluem itens" ON "public"."itens_venda_arrecadacao" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Usuários autenticados excluem vendas" ON "public"."vendas_arrecadacao" FOR DELETE TO "authenticated" USING (true);



ALTER TABLE "public"."agenda_igreja" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bloquear insert direto em caixas" ON "public"."caixas" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "bloquear update direto em caixas" ON "public"."caixas" FOR UPDATE TO "authenticated" USING (false);



ALTER TABLE "public"."caixas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."celula_membros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."celulas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."confirmacoes_membros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feed_publicacoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."itens_venda_arrecadacao" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lecionario" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leitura de caixas para autenticados" ON "public"."caixas" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."livros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."membros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissoes_auditoria" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissoes_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."registros_batismo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saidas_caixa" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "saidas_caixa_delete" ON "public"."saidas_caixa" FOR DELETE TO "authenticated" USING ("public"."tem_perfil"(ARRAY['administrador'::"text", 'tesouraria'::"text"]));



CREATE POLICY "saidas_caixa_insert" ON "public"."saidas_caixa" FOR INSERT TO "authenticated" WITH CHECK (("public"."pode"('operar_arrecadacoes'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."caixas" "c"
  WHERE (("c"."id" = "saidas_caixa"."caixa_id") AND ("c"."status" = 'aberto'::"text"))))));



CREATE POLICY "saidas_caixa_select" ON "public"."saidas_caixa" FOR SELECT TO "authenticated" USING ("public"."pode"('ver_relatorios_caixa'::"text"));



CREATE POLICY "saidas_caixa_update" ON "public"."saidas_caixa" FOR UPDATE TO "authenticated" USING (("public"."pode"('operar_arrecadacoes'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."caixas" "c"
  WHERE (("c"."id" = "saidas_caixa"."caixa_id") AND ("c"."status" = 'aberto'::"text")))))) WITH CHECK (("public"."pode"('operar_arrecadacoes'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."caixas" "c"
  WHERE (("c"."id" = "saidas_caixa"."caixa_id") AND ("c"."status" = 'aberto'::"text"))))));



ALTER TABLE "public"."vendas_arrecadacao" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT MAINTAIN ON TABLE "public"."caixas" TO "anon";
GRANT MAINTAIN ON TABLE "public"."caixas" TO "authenticated";
GRANT ALL ON TABLE "public"."caixas" TO "service_role";



GRANT ALL ON FUNCTION "public"."abrir_caixa"("p_valor_abertura" numeric, "p_observacoes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."abrir_caixa"("p_valor_abertura" numeric, "p_observacoes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."abrir_caixa"("p_valor_abertura" numeric, "p_observacoes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."atualizar_meu_foto"("nova_foto" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."atualizar_meu_foto"("nova_foto" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."atualizar_meu_foto"("nova_foto" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atualizar_meu_foto"("nova_foto" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."atualizar_meu_nome"("novo_nome" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."atualizar_meu_nome"("novo_nome" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."atualizar_meu_nome"("novo_nome" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atualizar_meu_nome"("novo_nome" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."atualizar_meu_perfil"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."atualizar_meu_perfil"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."atualizar_meu_perfil"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atualizar_meu_perfil"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."completar_meu_cadastro"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."completar_meu_cadastro"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."completar_meu_cadastro"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."completar_meu_cadastro"("p_nome" "text", "p_telefone" "text", "p_data_nascimento" "date", "p_sexo" "text", "p_endereco" "text", "p_funcao" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."conceder_permissao"("alvo_chave" "text", "alvo_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."conceder_permissao"("alvo_chave" "text", "alvo_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."conceder_permissao"("alvo_chave" "text", "alvo_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."email_normalizado"("valor" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."email_normalizado"("valor" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."email_normalizado"("valor" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."entrar_no_membro"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."entrar_no_membro"() TO "anon";
GRANT ALL ON FUNCTION "public"."entrar_no_membro"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."entrar_no_membro"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."excluir_membro_e_conta"("p_membro_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."excluir_membro_e_conta"("p_membro_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."excluir_membro_e_conta"("p_membro_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."excluir_membro_e_conta"("p_membro_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fechar_caixa"("p_valor_fechamento" numeric, "p_observacoes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fechar_caixa"("p_valor_fechamento" numeric, "p_observacoes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fechar_caixa"("p_valor_fechamento" numeric, "p_observacoes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."lider_da_celula"("alvo_celula" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lider_da_celula"("alvo_celula" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."lider_da_celula"("alvo_celula" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lider_da_celula"("alvo_celula" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."marcar_permissao_alterada"() TO "anon";
GRANT ALL ON FUNCTION "public"."marcar_permissao_alterada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_permissao_alterada"() TO "service_role";



GRANT ALL ON FUNCTION "public"."marcar_saida_editada"() TO "anon";
GRANT ALL ON FUNCTION "public"."marcar_saida_editada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_saida_editada"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."meu_membro"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."meu_membro"() TO "anon";
GRANT ALL ON FUNCTION "public"."meu_membro"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."meu_membro"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."minhas_celulas"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."minhas_celulas"() TO "anon";
GRANT ALL ON FUNCTION "public"."minhas_celulas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."minhas_celulas"() TO "service_role";



GRANT ALL ON FUNCTION "public"."minhas_permissoes"() TO "anon";
GRANT ALL ON FUNCTION "public"."minhas_permissoes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."minhas_permissoes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."papeis_que_formam_qualquer_celula"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."papeis_que_formam_qualquer_celula"() TO "anon";
GRANT ALL ON FUNCTION "public"."papeis_que_formam_qualquer_celula"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."papeis_que_formam_qualquer_celula"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pode"("chave_procurada" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pode"("chave_procurada" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pode"("chave_procurada" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pode_formar_qualquer_celula"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pode_formar_qualquer_celula"() TO "anon";
GRANT ALL ON FUNCTION "public"."pode_formar_qualquer_celula"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pode_formar_qualquer_celula"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."pode_vincular_esta_celula"("alvo_celula" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pode_vincular_esta_celula"("alvo_celula" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."pode_vincular_esta_celula"("alvo_celula" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pode_vincular_esta_celula"("alvo_celula" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pular_atualizacao_cadastral"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pular_atualizacao_cadastral"() TO "anon";
GRANT ALL ON FUNCTION "public"."pular_atualizacao_cadastral"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pular_atualizacao_cadastral"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reabrir_caixa"("p_caixa_id" "uuid", "p_observacoes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reabrir_caixa"("p_caixa_id" "uuid", "p_observacoes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reabrir_caixa"("p_caixa_id" "uuid", "p_observacoes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reabrir_caixa"("p_caixa_id" "uuid", "p_observacoes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."revogar_permissao"("alvo_chave" "text", "alvo_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."revogar_permissao"("alvo_chave" "text", "alvo_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revogar_permissao"("alvo_chave" "text", "alvo_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."role_em"("variaveis" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."role_em"("variaveis" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."role_em"("variaveis" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."tem_perfil"("perfis" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."tem_perfil"("perfis" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tem_perfil"("perfis" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."tocar_atualizado_em"() TO "anon";
GRANT ALL ON FUNCTION "public"."tocar_atualizado_em"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tocar_atualizado_em"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vincula_venda_ao_caixa_aberto"() TO "anon";
GRANT ALL ON FUNCTION "public"."vincula_venda_ao_caixa_aberto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."vincula_venda_ao_caixa_aberto"() TO "service_role";


















GRANT MAINTAIN ON TABLE "public"."agenda_igreja" TO "anon";
GRANT MAINTAIN ON TABLE "public"."agenda_igreja" TO "authenticated";
GRANT ALL ON TABLE "public"."agenda_igreja" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."celula_membros" TO "anon";
GRANT MAINTAIN ON TABLE "public"."celula_membros" TO "authenticated";
GRANT ALL ON TABLE "public"."celula_membros" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."celulas" TO "anon";
GRANT MAINTAIN ON TABLE "public"."celulas" TO "authenticated";
GRANT ALL ON TABLE "public"."celulas" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."confirmacoes_membros" TO "anon";
GRANT MAINTAIN ON TABLE "public"."confirmacoes_membros" TO "authenticated";
GRANT ALL ON TABLE "public"."confirmacoes_membros" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."feed_publicacoes" TO "anon";
GRANT MAINTAIN ON TABLE "public"."feed_publicacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_publicacoes" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."itens_venda_arrecadacao" TO "anon";
GRANT MAINTAIN ON TABLE "public"."itens_venda_arrecadacao" TO "authenticated";
GRANT ALL ON TABLE "public"."itens_venda_arrecadacao" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."lecionario" TO "anon";
GRANT MAINTAIN ON TABLE "public"."lecionario" TO "authenticated";
GRANT ALL ON TABLE "public"."lecionario" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."livros" TO "anon";
GRANT MAINTAIN ON TABLE "public"."livros" TO "authenticated";
GRANT ALL ON TABLE "public"."livros" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."membros" TO "anon";
GRANT MAINTAIN ON TABLE "public"."membros" TO "authenticated";
GRANT ALL ON TABLE "public"."membros" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."permissoes" TO "anon";
GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."permissoes" TO "authenticated";
GRANT ALL ON TABLE "public"."permissoes" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."permissoes_auditoria" TO "anon";
GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."permissoes_auditoria" TO "authenticated";
GRANT ALL ON TABLE "public"."permissoes_auditoria" TO "service_role";



GRANT ALL ON SEQUENCE "public"."permissoes_auditoria_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."permissoes_auditoria_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."permissoes_auditoria_id_seq" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."permissoes_roles" TO "anon";
GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."permissoes_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."permissoes_roles" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."registros_batismo" TO "anon";
GRANT MAINTAIN ON TABLE "public"."registros_batismo" TO "authenticated";
GRANT ALL ON TABLE "public"."registros_batismo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."registros_batismo_numero_registro_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."registros_batismo_numero_registro_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."registros_batismo_numero_registro_seq" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."saidas_caixa" TO "anon";
GRANT MAINTAIN ON TABLE "public"."saidas_caixa" TO "authenticated";
GRANT ALL ON TABLE "public"."saidas_caixa" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."vendas_arrecadacao" TO "anon";
GRANT MAINTAIN ON TABLE "public"."vendas_arrecadacao" TO "authenticated";
GRANT ALL ON TABLE "public"."vendas_arrecadacao" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

revoke delete on table "public"."agenda_igreja" from "anon";

revoke insert on table "public"."agenda_igreja" from "anon";

revoke references on table "public"."agenda_igreja" from "anon";

revoke select on table "public"."agenda_igreja" from "anon";

revoke trigger on table "public"."agenda_igreja" from "anon";

revoke truncate on table "public"."agenda_igreja" from "anon";

revoke update on table "public"."agenda_igreja" from "anon";

revoke delete on table "public"."agenda_igreja" from "authenticated";

revoke insert on table "public"."agenda_igreja" from "authenticated";

revoke references on table "public"."agenda_igreja" from "authenticated";

revoke select on table "public"."agenda_igreja" from "authenticated";

revoke trigger on table "public"."agenda_igreja" from "authenticated";

revoke truncate on table "public"."agenda_igreja" from "authenticated";

revoke update on table "public"."agenda_igreja" from "authenticated";

revoke delete on table "public"."caixas" from "anon";

revoke insert on table "public"."caixas" from "anon";

revoke references on table "public"."caixas" from "anon";

revoke select on table "public"."caixas" from "anon";

revoke trigger on table "public"."caixas" from "anon";

revoke truncate on table "public"."caixas" from "anon";

revoke update on table "public"."caixas" from "anon";

revoke delete on table "public"."caixas" from "authenticated";

revoke insert on table "public"."caixas" from "authenticated";

revoke references on table "public"."caixas" from "authenticated";

revoke select on table "public"."caixas" from "authenticated";

revoke trigger on table "public"."caixas" from "authenticated";

revoke truncate on table "public"."caixas" from "authenticated";

revoke update on table "public"."caixas" from "authenticated";

revoke delete on table "public"."celula_membros" from "anon";

revoke insert on table "public"."celula_membros" from "anon";

revoke references on table "public"."celula_membros" from "anon";

revoke select on table "public"."celula_membros" from "anon";

revoke trigger on table "public"."celula_membros" from "anon";

revoke truncate on table "public"."celula_membros" from "anon";

revoke update on table "public"."celula_membros" from "anon";

revoke delete on table "public"."celula_membros" from "authenticated";

revoke insert on table "public"."celula_membros" from "authenticated";

revoke references on table "public"."celula_membros" from "authenticated";

revoke select on table "public"."celula_membros" from "authenticated";

revoke trigger on table "public"."celula_membros" from "authenticated";

revoke truncate on table "public"."celula_membros" from "authenticated";

revoke update on table "public"."celula_membros" from "authenticated";

revoke delete on table "public"."celulas" from "anon";

revoke insert on table "public"."celulas" from "anon";

revoke references on table "public"."celulas" from "anon";

revoke select on table "public"."celulas" from "anon";

revoke trigger on table "public"."celulas" from "anon";

revoke truncate on table "public"."celulas" from "anon";

revoke update on table "public"."celulas" from "anon";

revoke delete on table "public"."celulas" from "authenticated";

revoke insert on table "public"."celulas" from "authenticated";

revoke references on table "public"."celulas" from "authenticated";

revoke select on table "public"."celulas" from "authenticated";

revoke trigger on table "public"."celulas" from "authenticated";

revoke truncate on table "public"."celulas" from "authenticated";

revoke update on table "public"."celulas" from "authenticated";

revoke delete on table "public"."confirmacoes_membros" from "anon";

revoke insert on table "public"."confirmacoes_membros" from "anon";

revoke references on table "public"."confirmacoes_membros" from "anon";

revoke select on table "public"."confirmacoes_membros" from "anon";

revoke trigger on table "public"."confirmacoes_membros" from "anon";

revoke truncate on table "public"."confirmacoes_membros" from "anon";

revoke update on table "public"."confirmacoes_membros" from "anon";

revoke delete on table "public"."confirmacoes_membros" from "authenticated";

revoke insert on table "public"."confirmacoes_membros" from "authenticated";

revoke references on table "public"."confirmacoes_membros" from "authenticated";

revoke select on table "public"."confirmacoes_membros" from "authenticated";

revoke trigger on table "public"."confirmacoes_membros" from "authenticated";

revoke truncate on table "public"."confirmacoes_membros" from "authenticated";

revoke update on table "public"."confirmacoes_membros" from "authenticated";

revoke delete on table "public"."feed_publicacoes" from "anon";

revoke insert on table "public"."feed_publicacoes" from "anon";

revoke references on table "public"."feed_publicacoes" from "anon";

revoke select on table "public"."feed_publicacoes" from "anon";

revoke trigger on table "public"."feed_publicacoes" from "anon";

revoke truncate on table "public"."feed_publicacoes" from "anon";

revoke update on table "public"."feed_publicacoes" from "anon";

revoke delete on table "public"."feed_publicacoes" from "authenticated";

revoke insert on table "public"."feed_publicacoes" from "authenticated";

revoke references on table "public"."feed_publicacoes" from "authenticated";

revoke select on table "public"."feed_publicacoes" from "authenticated";

revoke trigger on table "public"."feed_publicacoes" from "authenticated";

revoke truncate on table "public"."feed_publicacoes" from "authenticated";

revoke update on table "public"."feed_publicacoes" from "authenticated";

revoke delete on table "public"."itens_venda_arrecadacao" from "anon";

revoke insert on table "public"."itens_venda_arrecadacao" from "anon";

revoke references on table "public"."itens_venda_arrecadacao" from "anon";

revoke select on table "public"."itens_venda_arrecadacao" from "anon";

revoke trigger on table "public"."itens_venda_arrecadacao" from "anon";

revoke truncate on table "public"."itens_venda_arrecadacao" from "anon";

revoke update on table "public"."itens_venda_arrecadacao" from "anon";

revoke delete on table "public"."itens_venda_arrecadacao" from "authenticated";

revoke insert on table "public"."itens_venda_arrecadacao" from "authenticated";

revoke references on table "public"."itens_venda_arrecadacao" from "authenticated";

revoke select on table "public"."itens_venda_arrecadacao" from "authenticated";

revoke trigger on table "public"."itens_venda_arrecadacao" from "authenticated";

revoke truncate on table "public"."itens_venda_arrecadacao" from "authenticated";

revoke update on table "public"."itens_venda_arrecadacao" from "authenticated";

revoke delete on table "public"."lecionario" from "anon";

revoke insert on table "public"."lecionario" from "anon";

revoke references on table "public"."lecionario" from "anon";

revoke select on table "public"."lecionario" from "anon";

revoke trigger on table "public"."lecionario" from "anon";

revoke truncate on table "public"."lecionario" from "anon";

revoke update on table "public"."lecionario" from "anon";

revoke delete on table "public"."lecionario" from "authenticated";

revoke insert on table "public"."lecionario" from "authenticated";

revoke references on table "public"."lecionario" from "authenticated";

revoke select on table "public"."lecionario" from "authenticated";

revoke trigger on table "public"."lecionario" from "authenticated";

revoke truncate on table "public"."lecionario" from "authenticated";

revoke update on table "public"."lecionario" from "authenticated";

revoke delete on table "public"."livros" from "anon";

revoke insert on table "public"."livros" from "anon";

revoke references on table "public"."livros" from "anon";

revoke select on table "public"."livros" from "anon";

revoke trigger on table "public"."livros" from "anon";

revoke truncate on table "public"."livros" from "anon";

revoke update on table "public"."livros" from "anon";

revoke delete on table "public"."livros" from "authenticated";

revoke insert on table "public"."livros" from "authenticated";

revoke references on table "public"."livros" from "authenticated";

revoke select on table "public"."livros" from "authenticated";

revoke trigger on table "public"."livros" from "authenticated";

revoke truncate on table "public"."livros" from "authenticated";

revoke update on table "public"."livros" from "authenticated";

revoke delete on table "public"."membros" from "anon";

revoke insert on table "public"."membros" from "anon";

revoke references on table "public"."membros" from "anon";

revoke select on table "public"."membros" from "anon";

revoke trigger on table "public"."membros" from "anon";

revoke truncate on table "public"."membros" from "anon";

revoke update on table "public"."membros" from "anon";

revoke delete on table "public"."membros" from "authenticated";

revoke insert on table "public"."membros" from "authenticated";

revoke references on table "public"."membros" from "authenticated";

revoke select on table "public"."membros" from "authenticated";

revoke trigger on table "public"."membros" from "authenticated";

revoke truncate on table "public"."membros" from "authenticated";

revoke update on table "public"."membros" from "authenticated";

revoke delete on table "public"."permissoes" from "anon";

revoke insert on table "public"."permissoes" from "anon";

revoke references on table "public"."permissoes" from "anon";

revoke select on table "public"."permissoes" from "anon";

revoke trigger on table "public"."permissoes" from "anon";

revoke truncate on table "public"."permissoes" from "anon";

revoke update on table "public"."permissoes" from "anon";

revoke references on table "public"."permissoes" from "authenticated";

revoke select on table "public"."permissoes" from "authenticated";

revoke trigger on table "public"."permissoes" from "authenticated";

revoke truncate on table "public"."permissoes" from "authenticated";

revoke delete on table "public"."permissoes_auditoria" from "anon";

revoke insert on table "public"."permissoes_auditoria" from "anon";

revoke references on table "public"."permissoes_auditoria" from "anon";

revoke select on table "public"."permissoes_auditoria" from "anon";

revoke trigger on table "public"."permissoes_auditoria" from "anon";

revoke truncate on table "public"."permissoes_auditoria" from "anon";

revoke update on table "public"."permissoes_auditoria" from "anon";

revoke references on table "public"."permissoes_auditoria" from "authenticated";

revoke select on table "public"."permissoes_auditoria" from "authenticated";

revoke trigger on table "public"."permissoes_auditoria" from "authenticated";

revoke truncate on table "public"."permissoes_auditoria" from "authenticated";

revoke delete on table "public"."permissoes_roles" from "anon";

revoke insert on table "public"."permissoes_roles" from "anon";

revoke references on table "public"."permissoes_roles" from "anon";

revoke select on table "public"."permissoes_roles" from "anon";

revoke trigger on table "public"."permissoes_roles" from "anon";

revoke truncate on table "public"."permissoes_roles" from "anon";

revoke update on table "public"."permissoes_roles" from "anon";

revoke references on table "public"."permissoes_roles" from "authenticated";

revoke select on table "public"."permissoes_roles" from "authenticated";

revoke trigger on table "public"."permissoes_roles" from "authenticated";

revoke truncate on table "public"."permissoes_roles" from "authenticated";

revoke delete on table "public"."profiles" from "anon";

revoke insert on table "public"."profiles" from "anon";

revoke references on table "public"."profiles" from "anon";

revoke select on table "public"."profiles" from "anon";

revoke trigger on table "public"."profiles" from "anon";

revoke truncate on table "public"."profiles" from "anon";

revoke update on table "public"."profiles" from "anon";

revoke delete on table "public"."profiles" from "authenticated";

revoke insert on table "public"."profiles" from "authenticated";

revoke references on table "public"."profiles" from "authenticated";

revoke select on table "public"."profiles" from "authenticated";

revoke trigger on table "public"."profiles" from "authenticated";

revoke truncate on table "public"."profiles" from "authenticated";

revoke update on table "public"."profiles" from "authenticated";

revoke delete on table "public"."registros_batismo" from "anon";

revoke insert on table "public"."registros_batismo" from "anon";

revoke references on table "public"."registros_batismo" from "anon";

revoke select on table "public"."registros_batismo" from "anon";

revoke trigger on table "public"."registros_batismo" from "anon";

revoke truncate on table "public"."registros_batismo" from "anon";

revoke update on table "public"."registros_batismo" from "anon";

revoke delete on table "public"."registros_batismo" from "authenticated";

revoke insert on table "public"."registros_batismo" from "authenticated";

revoke references on table "public"."registros_batismo" from "authenticated";

revoke select on table "public"."registros_batismo" from "authenticated";

revoke trigger on table "public"."registros_batismo" from "authenticated";

revoke truncate on table "public"."registros_batismo" from "authenticated";

revoke update on table "public"."registros_batismo" from "authenticated";

revoke delete on table "public"."saidas_caixa" from "anon";

revoke insert on table "public"."saidas_caixa" from "anon";

revoke references on table "public"."saidas_caixa" from "anon";

revoke select on table "public"."saidas_caixa" from "anon";

revoke trigger on table "public"."saidas_caixa" from "anon";

revoke truncate on table "public"."saidas_caixa" from "anon";

revoke update on table "public"."saidas_caixa" from "anon";

revoke delete on table "public"."saidas_caixa" from "authenticated";

revoke insert on table "public"."saidas_caixa" from "authenticated";

revoke references on table "public"."saidas_caixa" from "authenticated";

revoke select on table "public"."saidas_caixa" from "authenticated";

revoke trigger on table "public"."saidas_caixa" from "authenticated";

revoke truncate on table "public"."saidas_caixa" from "authenticated";

revoke update on table "public"."saidas_caixa" from "authenticated";

revoke delete on table "public"."vendas_arrecadacao" from "anon";

revoke insert on table "public"."vendas_arrecadacao" from "anon";

revoke references on table "public"."vendas_arrecadacao" from "anon";

revoke select on table "public"."vendas_arrecadacao" from "anon";

revoke trigger on table "public"."vendas_arrecadacao" from "anon";

revoke truncate on table "public"."vendas_arrecadacao" from "anon";

revoke update on table "public"."vendas_arrecadacao" from "anon";

revoke delete on table "public"."vendas_arrecadacao" from "authenticated";

revoke insert on table "public"."vendas_arrecadacao" from "authenticated";

revoke references on table "public"."vendas_arrecadacao" from "authenticated";

revoke select on table "public"."vendas_arrecadacao" from "authenticated";

revoke trigger on table "public"."vendas_arrecadacao" from "authenticated";

revoke truncate on table "public"."vendas_arrecadacao" from "authenticated";

revoke update on table "public"."vendas_arrecadacao" from "authenticated";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Avatars são lidos por autenticados"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'avatars'::text));



  create policy "Fotos do feed são lidas por autenticados"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'postagens'::text));



  create policy "Usuário altera foto da própria publicação"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'postagens'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
with check (((bucket_id = 'postagens'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Usuário altera seu próprio avatar"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Usuário remove foto da própria publicação"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'postagens'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Usuário remove seu próprio avatar"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Usuário sobe foto da própria publicação"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'postagens'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Usuário sobe seu próprio avatar"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



