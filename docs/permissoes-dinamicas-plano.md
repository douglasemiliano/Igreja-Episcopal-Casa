# Permissões dinâmicas — o que foi implementado

> Status: **fase 1 no banco, fase 2 preparada e não aplicada**. A fase 1
> (catálogo, `pode()`, RPCs, tela) está no banco. A fase 2
> (policies que faltavam consultar `pode()`) está escrita e revisada em
> `supabase/20260927_permissoes_policies_restantes.sql`, mas **ainda não foi
> executada** — depende de passar pelo diagnóstico e da conferência da query 6
> descrita em `permissoes-fase-2.md`, seção 2.
> SQL: `supabase/20260927_permissoes_dinamicas.sql`,
> `supabase/20260927_permissoes_policies_restantes.sql`
> Reverter: `20260927_permissoes_dinamicas_rollback.sql`,
> `20260927_permissoes_policies_restantes_rollback.sql`
>
> Os números da seção 3 descrevem **o estado esperado depois da fase 2**, não o
> estado de agora. Hoje, no banco, são 4 das 17 chaves aplicadas.
>
> O desenho e as armadilhas estão abaixo. **A seção 3 é o que ainda não
> está**, e é a parte que importa antes de mexer em qualquer coisa.
> O detalhe da fase 2, com as decisões e o porquê de cada uma, está em
> `permissoes-fase-2.md`.

---

## 1. A ideia em uma frase

Trocar a permissão hardcoded (`f(role)`, escrita a mão em cada tela) por uma
permissão nomeada e configurável (`f(chave)`, lida de uma tabela que o
administrador edita), de modo que **exista uma lista de capacidades
("publicar evento", "reabrir caixa") e o admin decida quais papéis as
possuem**.

---

## 2. Por que foi feito

A mesma decisão estava escrita em dois lugares que não conversavam:

| Onde | Como estava |
| --- | --- |
| Front-end | arrays de roles dentro de cada componente, rota e item de menu |
| Banco | `public.tem_perfil(array['administrador', ...])` dentro de cada policy |

As duas listas já divergiram. O caso mais claro era a agenda, em
`supabase/20260920_melhorias_administrativas.sql:31-33`:

```sql
create policy "Secretaria e administradores criam agenda" on public.agenda_igreja
  for insert to authenticated with check (true);
```

O nome da policy registrava a intenção ("Secretaria e administradores"), mas o
corpo era `true`. Na prática **qualquer usuário autenticado inseria, edita e
apagava evento**, e o `podeEditar` do componente era só fachada.

**A regra que faz o desenho funcionar: a tabela no banco é a única fonte da
verdade, e as policies leem essa tabela. A tela de configuração é uma visão
dela, nunca a fonte.**

### 2.1 A premissa que sustenta isso

O app usa a chave de usuário do Supabase, não a `service_role`
(`supabase.service.ts` chama `createClient(environment.SUPABASE_URL,
environment.SUPABASE_KEY, ...)`, e não há `service_role` em nenhum arquivo de
`src/`).

Consequência: a RLS é o ponto de aplicação de fato, então uma tabela de
permissões no banco é realmente aplicável. **Se algum dia entrar uma
`service_role` no bundle, este desenho deixa de valer** e a segurança passa a
depender só do front — situação pior que a original.

---

## 3. O que está pronto e o que não está

Esta é a seção que mais importa, e a que a tela de /permissoes não deixa
enxergar.

**Estado de hoje: 4 das 17 chaves são aplicadas no banco.** Depois da fase 2
for aplicada, são 11. O resto desta seção descreve o estado final pretendido,
com o que muda em cada passo marcado.

### 3.1 As 4 chaves já aplicadas (fase 1, no banco)

| chave | Onde |
| --- | --- |
| `publicar_evento` | policy "Publicar evento" em `agenda_igreja` |
| `editar_evento` | policy "Editar evento" em `agenda_igreja` |
| `excluir_evento` | policy "Excluir evento" em `agenda_igreja` |
| `excluir_publicacao` | policy do DELETE em `feed_publicacoes` |

### 3.1b As 7 chaves que a fase 2 acrescenta (escrita, ainda não aplicada)

| chave | Onde |
| --- | --- |
| `publicar_publicacao` | policy do INSERT em `feed_publicacoes` |
| `cadastrar_membros` | policy do INSERT em `membros` |
| `registrar_batismo` | policy do INSERT em `registros_batismo` |
| `gerenciar_usuarios` | policy do UPDATE em `profiles`, com as regras por linha ao lado |
| `ver_relatorios_caixa` | policy do SELECT em `saidas_caixa` |
| `operar_arrecadacoes` | policies de INSERT e UPDATE em `saidas_caixa` |
| `reabrir_caixa` | RPC `reabrir_caixa` |

A fase 2 (`supabase/20260927_permissoes_policies_restantes.sql`) também corrige
duas concessões que teriam virado escalonamento. O detalhe está em
`permissoes-fase-2.md`.

### 3.2 As 6 chaves que continuam fora do banco

| chave | Por que |
| --- | --- |
| `ver_central` | índice de atalhos, nenhuma tabela |
| `ver_dashboard` | tela de indicadores, nenhuma tabela |
| `emitir_certificado` | o PDF é gerado no navegador; não escreve em tabela |
| `gerenciar_permissoes` | reservada; as RPCs exigem `tem_perfil(['administrador'])` |
| `ver_livro_registro` | só protege a rota — a **escrita** em `livros` segue em `tem_perfil` |
| `gerenciar_lecionario` | `lecionario` não tem RLS versionado (seção 3.4) |

Não são a mesma coisa, e a diferença importa: as três primeiras e a
`gerenciar_permissoes` não têm o que amarrar — não existe tabela envolvida, e
inventar uma seria teatro. As duas últimas têm tabela e continuam desprotegidas
pelo catálogo. As duas merecem leitura: a chave funciona como porta de entrada,
mas não como autorização. Ver seção 3.3.

### 3.3 Operações que ainda decidem por `tem_perfil`

A tela `/permissoes` não tem controle sobre nenhuma delas. São duas situações
distintas, e a diferença importa:

**Falta chave no catálogo.** Não existe chave que descreva o que a operação
faz, então não há como amarrar. São 9 operações, em 5 grupos:

| Grupo de operações | Quem pode hoje |
| --- | --- |
| abrir e fechar caixa (2 RPCs) | administrador, tesouraria |
| excluir saída de caixa (1) | administrador, tesouraria |
| editar e excluir membro (2) | administrador, secretaria |
| editar e excluir livro (2) | administrador, secretaria |
| editar e excluir batismo (2) | administrador, secretaria |

Quantas chaves isso vira depende de uma granularidade que ainda não foi
decidida, e a escolha muda o que a tela de /permissoes oferece:

- **1 chave por grupo** = 5 chaves (`gerenciar_caixa`, `excluir_saida_caixa`,
  `gerenciar_membros`, `gerenciar_livros`, `gerenciar_batismos`). Interface
  simples, e quem edita também exclui — hoje já é assim, porque o front e a
  policy usam a mesma condição.
- **1 chave por operação** = 8 chaves. Dá para liberar a edição e manter a
  exclusão restrita, mas multiplica os botões e a tela de configuração.

Quem decide é a igreja, não a migration.

**A chave existe, mas cobre mais do que a operação.** `ver_livro_registro` e
`gerenciar_lecionario` protegem a rota; a escrita nas tabelas correspondentes
continua em `tem_perfil`. São coisas diferentes: a chave decide quem abre a
tela, e quem escreve nela é outra policy.

Enquanto isso não fechar: **antes de conceder ou revogar uma chave desta
lista, lembrar que a alteração só afeta o que a tela mostra.**

### 3.4 Tabelas sem RLS versionado

`caixas`, `vendas_arrecadacao`, `itens_venda_arrecadacao` e `lecionario` não
têm `enable row level security` em nenhum script do repositório. A própria
migration das saídas admite isso em `20260926_saidas_e_reabertura_caixa.sql:54`:

> as tabelas caixas/vendas_arrecadacao não têm RLS versionado aqui; esta é a
> primeira do módulo com política explícita

**Este é o item mais caro que sobrou.** Sem RLS, a tabela é lida por qualquer
autenticado — e `caixas` e `vendas_arrecadacao` são dado financeiro.

A fase 2 não as tocou por dois motivos: `enable row level security` numa
tabela sem nenhuma policy bloqueia a leitura para todo mundo, e o estado real
delas é desconhecido, porque se tiverem policies elas foram criadas direto no
Dashboard e não estão versionadas.

O caminho é rodar `supabase/20260927_diagnostico_rls.sql` (somente leitura) e
só então escrever a migration. Detalhe em `permissoes-fase-2.md`, seção 4.1.

---

## 4. Modelo de dados

```sql
-- Catálogo de capacidades. Criado por migration, nunca digitado na tela.
create table public.permissoes (
  chave     text primary key,
  rotulo    text    not null,
  descricao text,
  categoria text    not null default 'Geral',
  ordenacao int     not null default 100,
  reservada boolean not null default false
);

create table public.permissoes_roles (
  chave text not null references public.permissoes(chave) on delete cascade,
  role  text not null,
  primary key (chave, role)
);
```

### 4.1 `reservada` é coluna, e não `CHECK` — e por quê

O desenho original previa
`check (chave <> 'gerenciar_permissoes')`, resolvendo a chave fora do catálogo.
A implementação usa a coluna `reservada`, e a troca é melhor: a tela **mostra**
a chave trancada, com a explicação de por que ela não é mexível, em vez de
escondê-la. Esconder uma linha do catálogo faz o administrador achar que ela
não existe; vê-la trancada ensina o que o sistema reserva e por quê.

A proteção real não está na coluna: está dentro de `pode()` e dentro de
`conceder_permissao()`, que recusam a chave reservada. A coluna é a
representação; a checagem é a garantia.

### 4.2 `permissoes_roles.role` não tem `CHECK`

A lista canônica de papéis continua morando em
`profiles_roles_check` (`20260925_roles_multiplas_e_feed.sql:56-58`) e é
espelhada em `SupabaseService.rolesDisponiveis`. `permissoes_roles.role` é
`text` solto, sem restrição.

Foi escolha consciente: a lista de papéis pode crescer (uma igreja pode ganhar
um papel novo) e um `CHECK` aqui viraria uma segunda lista para lembrar de
atualizar. O custo é que uma concessão para um papel inexistente passa
silenciosamente. Ver a decisão 4 da seção 10.

---

## 5. A função `pode()`

```sql
create or replace function public.pode(chave_procurada text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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
```

O parâmetro chama `chave_procurada`, e não `chave`, de propósito: com o nome
igual ao da coluna, o SQL exigiria `public.pode.chave` e a função ficaria
mais difícil de ler.

`security definer` permite ler `permissoes_roles` e `profiles` sem passar pela
RLS delas — é o mesmo motivo pelo qual `tem_perfil` funciona. `set search_path
= public` impede sequestro de `search_path`.

**`and not p.reservada` é a defesa da chave reservada dentro da função.** Mesmo
que alguém conseguisse inserir uma linha em `permissoes_roles` para
`gerenciar_permissoes`, `pode()` continuaria ignorando. A restrição é por
construção, não por conveniência — e é a segunda camada, depois do
`raise exception` em `conceder_permissao()`.

### 5.1 RLS das próprias tabelas de permissão

Leitura liberada a autenticados: é configuração, não dado sensível, e a tela do
admin precisa ler a matriz inteira para desenhar as caixas.

```sql
create policy "Autenticados consultam permissoes" on public.permissoes
  for select to authenticated using (true);
create policy "Autenticados consultam permissoes_roles" on public.permissoes_roles
  for select to authenticated using (true);
```

### 5.2 Escrita só por RPC, e só por administrador

O passo que não pode faltar: **revogar a escrita direta.** Em Supabase o papel
`authenticated` costuma ter `ALL` por padrão nas tabelas de `public`. Sem o
`revoke`, um administrador escreve em `permissoes_roles` pelo REST e contorna
o gatilho de auditoria.

```sql
revoke insert, update, delete on public.permissoes from authenticated;
revoke insert, update, delete on public.permissoes_roles from authenticated;
revoke insert, update, delete on public.permissoes_auditoria from authenticated;
```

Só funções `security definer` escrevem depois disso, e o rastro fica
garantido. `conceder_permissao()` e `revogar_permissao()` exigem
`tem_perfil(array['administrador'])` e recusam chave reservada ou desconhecida.

### 5.3 O conjunto do usuário, em uma chamada

```sql
create or replace function public.minhas_permissoes()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p.chave), '{}'::text[])
  from public.permissoes p
  where public.pode(p.chave);
$$;
```

O front busca isso uma vez e consulta localmente, sem ir ao banco a cada
`@if`.

### 5.4 Auditoria

`public.permissoes_auditoria` + trigger `after insert or delete` em
`permissoes_roles`, gravando `auth.uid()`, chave, role, operação e horário.
Mesmo padrão de `20260926_auditoria_saidas_caixa.sql`: o rastro vem do trigger,
nunca do cliente. Só o administrador lê.

---

## 6. `pode()` é por papel, não por linha

`pode()` responde "**este papel** pode fazer isto, em algum lugar". Ele não
sabe nada sobre a linha. Então regra por dono continua somada como condição
adicional:

- papel pode, em qualquer linha → `using (public.pode('chave'))`
- papel pode, mas só no que é seu → `using (public.pode('chave') and autor_id = auth.uid())`
- não é permissão, é posse → `using (autor_id = auth.uid())` puro

O caso do feed mostra a diferença. O UPDATE ficou **fora** de `pode()`, porque
"cada um edita o que escreveu" é regra por linha, e `pode()` não tem como
expressar isso:

```sql
-- 20260927_permissoes_postagens.sql
create policy "Autor edita a própria publicação" on public.feed_publicacoes
  for update to authenticated
  using (autor_id = auth.uid())
  with check (autor_id = auth.uid());
```

O `with check` também vale `autor_id = auth.uid()`. Sem ele, o autor poderia
reescrever a própria linha e transferir a autoria para outra pessoa.

O DELETE é a soma dos dois níveis, e é onde `pode()` entra:

```sql
-- 20260927_permissoes_dinamicas.sql
create policy "Autor, administrador e pastor removem publicação" on public.feed_publicacoes
  for delete to authenticated
  using (autor_id = auth.uid() or public.pode('excluir_publicacao'));
```

Misturar os dois levels é o erro mais provável aqui: trocar
`autor_id = auth.uid()` por `pode('editar_publicacao')` devolveria
silenciosamente a edição de post alheio ao administrador.

---

## 7. Catálogo

17 chaves. 1 reservada. As concessões iniciais reproduzem exatamente os arrays
que estavam escritos à mão no front, para que a troca não mudasse o acesso de
ninguém. Depois da migration, quem muda é o admin, na tela.

| chave | categoria | quem tem |
| --- | --- | --- |
| `ver_central` | Igreja | administrador, secretaria, caixa, tesouraria, pastor, lider |
| `publicar_evento` | Igreja | administrador, secretaria, pastor |
| `editar_evento` | Igreja | administrador, secretaria, pastor |
| `excluir_evento` | Igreja | administrador, secretaria, pastor |
| `publicar_publicacao` | Igreja | administrador, lider |
| `excluir_publicacao` | Igreja | administrador, pastor |
| `operar_arrecadacoes` | Caixa | administrador, caixa, tesouraria, pastor |
| `ver_relatorios_caixa` | Caixa | administrador, secretaria, caixa, tesouraria, pastor |
| `reabrir_caixa` | Caixa | administrador, tesouraria |
| `cadastrar_membros` | Comunidade | administrador, secretaria † |
| `ver_dashboard` | Comunidade | administrador, secretaria, tesouraria, pastor |
| `emitir_certificado` | Registros | administrador, secretaria, pastor |
| `ver_livro_registro` | Registros | administrador, secretaria, pastor |
| `registrar_batismo` | Registros | administrador, secretaria † |
| `gerenciar_lecionario` | Registros | administrador, secretaria, pastor |
| `gerenciar_usuarios` | Administração | administrador, pastor |
| `gerenciar_permissoes` | Administração | **ninguém — reservada** |

`gerenciar_permissoes` é a única com `reservada = true`, e não tem nenhuma
linha em `permissoes_roles`. Quem tem `administrador` não depende dela: o
bypass dentro de `pode()` e a checagem dentro das RPCs já cobrem o
administrador. A chave existe no catálogo para aparecer trancada na tela.

**† As duas chaves marcadas perderam o pastor na fase 2.** A semeadura original
copiou os arrays do front, que permitiam; a policy da tabela nunca permitiu.
Aplicar `pode()` sem corrigir isso dava escrita em membros e em batismos ao
pastor sem ninguém ter decidido isso. A concessão foi corrigida para baixo, e a
decisão de re-admissão ficou registrada em `permissoes-fase-2.md`, seção 3.

### 7.1 Sobre a convenção de nome

O desenho original previa o par `ver_*` (abre a tela) / `fazer_*` (liga o
botão), sempre semeado junto. O que ficou é diferente, e a diferença é
informativa: **não existe `fazer_*`**. As chaves são nomeadas pelo verbo de
domínio (`publicar_evento`, `excluir_publicacao`, `operar_arrecadacoes`), e
`ver_*` cobre só as telas que são puro portão de navegação
(`ver_central`, `ver_dashboard`).

A agenda é o caso que prova a regra: **não existe `ver_agenda`**, porque o
SELECT dela é `using (true)` — todo mundo lê a agenda, e o que é restrito são
os botões. Semear `ver_agenda` seria dar ao administrador a impressão de estar
decidindo algo que ele não decide.

---

## 8. Front-end

`PermissaoService` (`src/app/services/permissao.service.ts`) guarda um
`signal<ReadonlySet<string>>` e expõe `pode(chave)`. Três decisões que não são
óbvias:

**A falha assume o pior.** Se `minhas_permissoes` falhar, o conjunto é
esvaziado e a interface esconde tudo. Esconder é o comportamento seguro: botão
que some é reversível, botão que aparece sem autorização é incidente.

**A chamada é deduplicada e tem janela de 30s.** `carregar()` segura a promessa
em voo e ignora chamadas dentro da janela, porque o `AuthGuard` roda em toda
navegação protegida e sem isso cada ida para uma página seria uma ida ao banco.

**A carga é invalidada quando a aba volta ao foco** (`visibilitychange`, com o
mesmo throttle). A mudança de permissão é exatamente o motivo da tela existir;
quem está logado pode tê-la mudada por baixo, e a próxima ida à tela já é com o
conjunto novo. `limpar()` roda no logout, para o próximo login não herdar o
conjunto do usuário anterior.

### 8.1 Como cada lugar virou

| Antes | Agora |
| --- | --- |
| `RoleGuard` + `data: { roles: [] }` | `PermissaoGuard` + `data: { chave }` |
| 8 arrays de roles em `menu.service.ts` | `chave: string` por item, com `disponiveis(pode)`, `grupos(pode)` e `buscar(pode, termo)` |
| `rolesPermitidos` na agenda | `pode('publicar_evento')`, `pode('editar_evento')`, `pode('excluir_evento')` |
| `rolesPublicadores` no feed | `pode('publicar_publicacao')` |
| `rolesDashboard` na central | `pode(chave)`, com a mesma chave da rota, para atalho e rota não divergirem |
| `ROLES_REABERTURA` nos relatórios | `pode('reabrir_caixa')` |

`getRoles()` continua existindo em `SupabaseService`: papéis ainda são a
unidade atribuída a uma pessoa, e o gerenciador de usuários precisa da lista
para oferecer. `rolesDisponiveis` é catálogo de papéis, não permissão — por
isso não virou chave.

O `AuthGuard` chama `permissao.carregar()` depois de confirmar o login, e é o
único lugar do front onde não dá para o conjunto chegar vazio por descuido: o
`PermissaoGuard` e todos os `@if` das telas dependem disso.

---

## 9. Armadilhas

1. **A tela não é a fonte — e isso ainda não vale para tudo.** Hoje, 4 das 17
   chaves são aplicadas no banco; a fase 2 leva a 11. Das 6 que ficam de fora,
   quatro não têm tabela para amarrar, mas `ver_livro_registro` e
   `gerenciar_lecionario` protegem rota sem proteger dado. E 10 operações seguem
   decididas por `tem_perfil` ou por tabela sem RLS. Ver seção 3. É a
   armadilha ativa.
2. **Não amarrar policy a chave que o front não checa.** O inverso do item 1
   também quebra: botão que aparece e banco que recusa. Toda policy nova
   precisa do `@if` no mesmo commit, ou o item 1 se transforma no seu oposto.
3. **Nunca semear uma chave com lista mais larga que a policy que ela
   substitui.** Foi o que quase aconteceu com `cadastrar_membros` e
   `registrar_batismo` na fase 2, e teria dado escrita em membros ao pastor.
   A concessão vai para baixo, e a divergência para o doc.
4. **Administrador com bypass hardcoded dentro de `pode()`.** Não revogável, e
   por isso dispensa a proteção de "último administrador": com o bypass, é
   impossível trancar todo mundo fora.
5. **`pode()` é por papel, não por linha.** Ver seção 6. O erro mais provável é
   trocar `autor_id = auth.uid()` por `pode('editar_publicacao')` e devolver
   silenciosamente a edição de post alheio.
6. **`revoke` de escrita nas tabelas de permissão** (seção 5.2). Sem ele a
   auditoria é contornável pelo REST.
7. **Toda chave nasce na migration do catálogo.** O catálogo é a lista que a
   tela renderiza; nada de digitar chave na mão.
8. **Não reutilizar uma chave que existe só porque o par de papéis bate.**
   `reabrir_caixa` e "excluir saída de caixa" são as mesmas duas pessoas, e
   nomear uma pelo nome da outra é uma mentira na tela de configuração.
9. **Não trocar papel por permissão individual.** Permissão por pessoa vira
   matriz impossível de administrar numa igreja com centenas de membros. Papel
   é a unidade atribuída; capacidade é o que o papel faz.
10. **Rollback é metade banco, metade código.** Reverter só o SQL das
    permissões dinâmicas deixa o app inutilizável: o `PermissaoGuard` barra
    toda rota com `chave`, e sem `minhas_permissoes` o conjunto chega vazio.
11. **Rollback da fase 1 reabre o furo da agenda.** As policies originais têm
    `true` no corpo. Se o problema for a adynamicidade e não a segurança, o
    script tem uma variante que mantém a agenda trancada por `tem_perfil`.

---

## 10. Regra de trabalho para funcionalidades novas

O objetivo declarado era: toda funcionalidade nova já "@ifs olhando para a
flag". Completo, para não ficar ambíguo:

1. A chave entra no catálogo por migration, com rótulo e categoria.
2. A policy chama `public.pode('<chave>')`.
3. O template esconde com `@if (permissao.pode('<chave>'))`.
4. O item do menu recebe `chave: '<chave>'`, e a rota recebe `data: { chave }`.

**Os quatro no mesmo commit.** Se existe `@if` numa chave e não existe policy
usando `pode()` com a mesma chave, é o bug da agenda se reproduzindo — a tela
mente e o banco aceita.

A exceção aceita de propósito hoje: as chaves de navegação (`ver_*` de tela pura)
não têm policy, porque a tabela que elas protegem tem regra própria. Registrar
essa exceção no commit é o que evita a interpretação errada de que faltou
policy.

---

## 11. Como verificar

A policy está valendo de verdade, olhando o corpo cadastrado:

```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Achar furo do tipo `using (true)`. **Restrinja a escrita**, porque `SELECT`
com `using (true)` é intencional em `agenda_igreja`, `feed_publicacoes` e
`profiles` — a query crua sempre retorna essas e treina a ignorar o resultado:

```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and cmd <> 'select'
  and (qual = 'true' or with_check = 'true')
order by tablename, policyname;
```

A chave reservada não pode ter nenhuma concessão:

```sql
select count(*) as concessoes_reservadas
from public.permissoes_roles pr
join public.permissoes p on p.chave = pr.chave
where p.reservada;  -- tem que dar 0
```

Conferir a cobertura descrita na seção 3 — quais chaves têm policy, quais
não:

```sql
-- chaves usadas pelo front que nenhuma policy consulta
select chave from public.permissoes
where chave not in ('gerenciar_permissoes')
  and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and qual like '%' || chave || '%'
  )
order by chave;
```

Teste de comportamento, com o token de um papel **sem** a permissão, contra o
REST direto — se isto passar, a tela está mentindo:

```
POST /rest/v1/agenda_igreja
Authorization: Bearer <token de membro sem publicar_evento>
```

### Checklist de conclusão

- [x] `permissoes` contém 17 chaves, 1 reservada
- [x] `concessoes_reservadas` = 0
- [x] nenhuma das 3 policies `true` de escrita da agenda sobrou
- [x] nenhum array de roles sobrou em `app.routes.ts` e `menu.service.ts`
- [x] nenhuma `service_role` no bundle
- [x] 4 chaves do catálogo aplicadas em policy ou RPC (fase 1)
- [ ] **7 chaves da fase 2 aplicadas** — a migration está escrita, falta rodar
      o diagnóstico e a conferência da query 6 (`permissoes-fase-2.md`, seção 2)
- [ ] **nenhuma das 7 operações da fase 2 concede acesso a quem não tinha** —
      conferível com o teste de comportamento documentado
- [ ] **`caixas`, `vendas_arrecadacao`, `itens_venda_arrecadacao` e
      `lecionario` têm RLS versionado** (seção 3.4) — *o item mais caro*
- [ ] **as 9 operações da seção 3.3 têm chave e botão** (5 ou 8 chaves, conforme
      a granularidade que a igreja escolher)
- [ ] nenhuma tabela com `authenticated` tendo `ALL` sem `revoke` explícito

---

## 12. Decisões em aberto

1. **As tabelas sem RLS são o próximo passo, não as chaves que faltam.**
   `caixas` e `vendas_arrecadacao` sem RLS significam que qualquer membro
   logado lê o caixa da igreja. Isso é mais grave do que a tela não cobrir as
   9 operações da seção 3.3, e é mais barato de fechar. Ver seção 3.4.
2. **Pastor cadastra membro e registra batismo?** A fase 2 retirou o pastor
   dessas duas chaves para não conceder acesso por acidente, porque a policy
   nunca deu esse acesso e o front sempre mostrou. Se a igreja quiser, é uma
   linha por chave. Ver `permissoes-fase-2.md`, seção 3.
3. **Escopo de `secretaria` e `tesouraria`.** Hoje secretaria não mexe em caixa
   nem tesouraria não cadastra membro. Ao virar configuração, essas combinações
   passam a ser escolhíveis na tela. Convém revisar se a igreja quer essa
   flexibilidade ou se algumas separações são estruturais.
4. **Override por usuário.** Não está no desenho. Se precisar (uma secretaria
   que publica evento mas não edita livro), o caminho seria
   `permissoes_usuarios`, e a policy viraria
   `pode(...) or exists (permissoes_usuarios)`. Aí vale refazer a seção 6 com
   calma.
5. **`CHECK` em `permissoes_roles.role`.** Hoje não existe, por escolha
   (seção 4.2). Se a lista de papéis estabilizar, é a hora de espelhar
   `profiles_roles_check` aqui também.
6. **Quem publica evento depois disso?** É dado, não código: uma linha em
   `permissoes_roles` editável na tela.
7. **Granularidade das chaves que faltam.** 1 chave por grupo (5) ou 1 por
   operação (8). Ver seção 3.3.
