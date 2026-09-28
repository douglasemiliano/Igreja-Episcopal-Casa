-- ============================================================================
-- 20260930_unico_email_membro.sql
--
-- O que faz: torna unico o indice sobre o email normalizado em public.membros.
--
-- Por que agora: 20260927_vincular_membros.sql ja criou
--   idx_membros_email_normalizado on public.membros (lower(btrim(coalesce(email, ''))))
-- mas como indice COMUM. A busca de entrar_no_membro normaliza o email a cada
-- chamada, e quando acha mais de um membro devolve status 'ambiguo' em vez de
-- vincular. Ou seja: a duplicata so aparece como um login que nao entra, e o
-- unico jeito de chegar nela e a consulta 9.2 do 20260927.
--
-- O indice unico troca esse diagnostico por impossibilidade: nao entra mais
-- uma segunda linha com o mesmo email. A tabela ganha a garantia de que
-- public.email_normalizado(email) aponta para um unico membro.
--
-- O indice precisa ser UNIQUE sobre a MESMA expressao que a busca usa. Nao da
-- para colocar unique em (email) cru: 'Teste@Gmail.com' e 'teste@gmail.com'
-- sao a mesma pessoa, e o indice cru aceitaria as duas.
--
-- O que NAO faz:
--   - nao funde linhas duplicadas, nao escolhe quem sobrevive
--   - nao normaliza o texto gravado (o dado continua como a pessoa digitou)
--   - nao mexe em confirmacoes_membros nem em nenhum outro arquivo
--
-- Aplicar: no SQL Editor, o arquivo inteiro. Deve rodar sem erro mesmo que o
-- indice ja exista unico.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0) Pre-requisito: a funcao de normalizacao precisa existir
-- ----------------------------------------------------------------------------
-- O indice usa a expressao direto (lower(btrim(...))), nao a funcao, porque
-- indice sobre funcao impede o uso por seek. Mas a funcao e o contrato do
-- login, entao a ausencia dela e erro de ordem de aplicacao, nao um detalhe.
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'email_normalizado'
  ) then
    raise exception
      'Falta public.email_normalizado(text). Aplique 20260927_vincular_membros.sql antes desta.';
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 1) Diagnostico antes de mudar
-- ----------------------------------------------------------------------------
-- Se ja existe membro vinculado e pre-cadastro com o mesmo email, criar o
-- indice unico agora aborta com 23505 e a migration inteira para. Verificar
-- antes deixa a secretaria resolver o dado em vez de o banco recusar.
--
-- O filtro `user_id is null` nao esta aqui de proposito: um email duplicado
-- entre um membro confirmado e um pre-cadastro tambem quebra o indice. Quem
-- busca e o login, e ele alcanca os dois lados.
select public.email_normalizado(m.email) as email,
       count(*)                          as ocorrencias,
       array_agg(m.id order by m.id)    as ids,
       array_agg(m.user_id is not null order by m.id) as vinculados
  from public.membros m
 where m.email is not null
   and btrim(m.email) <> ''
 group by 1
having count(*) > 1
 order by 2 desc, 1;


-- ----------------------------------------------------------------------------
-- 2) Barrar se o dado ainda nao aguentar o indice
-- ----------------------------------------------------------------------------
-- Sem esta guarda, uma duplicata faz o `create unique index` estourar 23505 e o
-- SQL Editor devolve o erro cru, sem dizer WHICH email esta repetido. A
-- excecao abaixo nomeia o problema e manda para o diagnostico da secao 1.
do $$
declare
  v_conflitos text;
begin
  select string_agg(email || ' (' || ocorrencias || 'x)', ', ' order by ocorrencias desc, email)
    into v_conflitos
    from (
      select public.email_normalizado(m.email) as email,
             count(*)                          as ocorrencias
        from public.membros m
       where m.email is not null
         and btrim(m.email) <> ''
       group by 1
      having count(*) > 1
    ) d;

  if v_conflitos is not null then
    raise exception
      'Nao foi possivel criar o indice unico: email repetido em membros -> %', v_conflitos;
  end if;

  -- Mesma colisao pelo caminho do coalesce: duas linhas sem email viram '' e
  -- colidem uma com a outra. A checagem 3.3 explica o conserto (indice parcial).
  if (select count(*) from public.membros
        where email is null or btrim(email) = '') > 1 then
    raise exception
      'Ha mais de um membro sem email. Com coalesce(email, '''') eles colidem no '
      'indice unico; use um indice parcial, como descreve a checagem 3.3.';
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 3) Trocar o indice comum pelo unico
-- ----------------------------------------------------------------------------
-- IF NOT EXISTS com o mesmo nome nao faria nada aqui, porque o indice de 20260927
-- tem o MESMO nome e ja existe — `create unique index if not exists` veria o
-- nome ocupado e seguiria em silencio, deixando tudo como estava. Por isso o
-- drop antes: e o que faz a troca acontecer de fato e deixar a migration
-- reexecutavel.

drop index if exists public.idx_membros_email_normalizado;

create unique index if not exists idx_membros_email_normalizado
  on public.membros (lower(btrim(coalesce(email, ''))));

comment on index public.idx_membros_email_normalizado is
  'Unico por email normalizado: bloqueia a segunda linha com o mesmo email. '
  'Unico sobre a expressao, e nao sobre a coluna crua, porque a busca do login '
  'normaliza. As guardas da secao 2 impedem que o indice seja criado sobre dado '
  'duplicado; se ele existir, o dado foi conferido.';


-- ----------------------------------------------------------------------------
-- 4) Checagem
-- ----------------------------------------------------------------------------

-- 4.1) tem de existir exatamente 1 linha, com unico = true
-- `indisunique` mora em pg_index (apelidado de x), e não em pg_class. A coluna
-- indisunique de pg_class não existe: ela descreve o índice, não a tabela, e é
-- por isso que a query precisa do join com pg_index.
select i.relname    as indice,
       x.indisunique as unico
  from pg_class t
  join pg_index x on x.indrelid = t.oid
  join pg_class i on i.oid = x.indexrelid
 where t.relname = 'membros'
   and t.relnamespace = 'public'::regnamespace
   and i.relname = 'idx_membros_email_normalizado';

-- 4.2) tem de dar zero linhas agora: nenhuma duplicata sobreviveu
select public.email_normalizado(m.email) as email,
       count(*)                          as ocorrencias
  from public.membros m
 where m.email is not null
   and btrim(m.email) <> ''
 group by 1
having count(*) > 1;

-- 4.3) este resultado valida o desenho do índice
-- Se der mais de 1, havia mais de um membro sem email. A guarda da seção 2
-- teria interrompido a migration antes do create, então este zero é o esperado
-- depois de aplicada.
--
-- Se algum dia o banco chegar a 2+, o índice único acima não pode existir, porque
-- as duas linhas sem email colidem: coalesce(email, '') produz '' nas duas. E o
-- login usa exatamente essa expressão, então o índice precisa refletir ela. O
-- índice correto nesse caso é um UNIQUE PARCIAL, que só restringe quem tem
-- email de verdade:
--
--   drop index public.idx_membros_email_normalizado;
--   create unique index idx_membros_email_normalizado
--     on public.membros (lower(btrim(email)))
--    where email is not null and btrim(email) <> '';
--
-- Isso é melhor que dar email a alguém só para agradar o índice: a pessoa entra
-- no cadastro sem e-mail o tempo todo, e o índice parcial é a forma de
-- respeitar isso.
select count(*) as membros_sem_email
  from public.membros
 where email is null or btrim(email) = '';
