-- ============================================================================
-- 20260929_perfil_do_membro.sql
--
-- O perfil passa a ser o cadastro do membro, e não mais o que veio do Google.
--
-- Antes: /perfil lia `auth.users.user_metadata` e salvava em `profiles` pela
-- RPC `atualizar_meu_nome`. O resultado era uma tela que mostrava o nome que o
-- Google mandou no primeiro login, enquanto a lista de membros mostrava outro.
-- Duas verdades para a mesma pessoa, e nenhuma delas avisando a outra.
--
-- Agora: a tela lê e escreve `membros`. `profiles` continua sendo a conta
-- (e-mail, papel, foto), e o nome é espelhado lá para o cabeçalho do app não
-- passar a mostrar outra coisa depois do salvamento.
--
-- Por que uma função e não um UPDATE direto: a RLS de `membros` deixa
-- atualizar só para quem tem permissão de administer membros. Um membro comum
-- não pode mexer na própria linha por `authenticated`, então a escrita tem de
-- passar por SECURITY DEFINER, que só aceita a linha do próprio `auth.uid()`.
-- ============================================================================


-- ============================================================================
-- 1) ATUALIZAR MEU PERFIL
-- ============================================================================
-- Diferença para `completar_meu_cadastro`, que parece quase igual:
--
--   - NÃO mexe em `cadastro_completo` nem em `cadastro_verificado_em`. São
--     o que faz o AuthGuard liberar a pessoa depois do primeiro acesso, e
--     editar o perfil no meio do caminho não pode reescrever essa história.
--     Sem esta distinção, quem pulou a tela e depois a edita receberia um
--     carimbo sem tê-lo passado por ela.
--
--   - NÃO aceita `data_entrada` nem `nome_batismo`. Isso é da secretaria: a
--     data de entrada é fato histórico e o nome de batismo não é informação
--     que a pessoa deve poder reescrever.
-- ============================================================================

create or replace function public.atualizar_meu_perfil(
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


-- ============================================================================
-- 2) PERMISSOES
-- ============================================================================

revoke all on function public.atualizar_meu_perfil(text, text, date, text, text, text) from public, anon;
grant  execute on function public.atualizar_meu_perfil(text, text, date, text, text, text) to authenticated;


-- ============================================================================
-- 3) CHECAGEM
-- ============================================================================

-- 3.1) Tem que aparecer aqui. Ausente = este arquivo não rodou.
select p.proname as funcao,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_executa
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'atualizar_meu_perfil';

-- 3.2) A RLS de `membros` tem de continuar fechada para INSERT e DELETE, e
--      com o UPDATE só para quem administra. Esta função não afrouxa nada
--      disso: ela é a única via de escrita do próprio cadastro, e só para a
--      própria linha. Se o UPDATE estiver aberto aqui, alguém achou um
--      contorno e vale fechar.
select pol.polname as policy,
       case pol.polcmd
         when 'r' then 'SELECT'  when 'a' then 'INSERT'
         when 'w' then 'UPDATE'  when 'd' then 'DELETE'
         when '*' then 'TODAS'
       end         as operacao,
       pg_get_expr(pol.polqual, pol.polrelid) as usando
  from pg_policy pol
  join pg_class rel on rel.oid = pol.polrelid
 where rel.relname = 'membros'
   and rel.relnamespace = 'public'::regnamespace
   and pol.polcmd in ('w', 'a', 'd')
 order by pol.polcmd, pol.polname;
