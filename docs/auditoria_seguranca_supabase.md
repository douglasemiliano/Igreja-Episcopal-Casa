# Auditoria de Segurança — Supabase & SQL Injection

**Escopo:** 15 migrations em `supabase/`, `src/environments/`, `src/app/services/supabase.service.ts` e demais_services do front-end.
**Data:** 2026-09-26
**Método:** leitura estática do repositório. **Nenhuma conexão com o banco de produção foi feita** — ver [Limitações](#limitações-desta-auditoria).

---

## Sumário executivo

| Severidade | Quantidade |
|---|---|
| 🔴 Crítica | 1 |
| 🟠 Alta | 2 |
| 🟡 Média | 4 |
| 🔵 Baixa | 2 |
| ⚪ Informativo | 3 |

**A arquitetura está bem desenhada.** Não há `service_role` vazado, não há SQL dinâmico com entrada de usuário, não há sink de XSS, e todo `SECURITY DEFINER` tem `search_path`. Os controles das tabelas mais sensíveis que *estão* versionadas (`saidas_caixa`, `feed_publicacoes`) são exemplares.

O problema não é o que foi escrito — é **o que não está no repositório**: as 6 tabelas que o app usa, incluindo as três de dinheiro, não têm nenhuma policy versionada. E há uma policy em produção que mente no nome.

---

## 1. Row Level Security (RLS)

### O que está certo

- [x] **RLS ativado** com `alter table ... enable row level security` nas 7 tabelas versionadas.
- [x] **Políticas restritas por papel** via `public.tem_perfil(array[...])`, que consulta `profiles.roles` do próprio usuário com `auth.uid()`.
- [x] `USING` e `WITH CHECK` presentes em todo `UPDATE` — sem `WITH CHECK`, um usuário poderia escrever uma linha que não consegue ler.
- [x] Isolamento de escrita no feed: `with check (autor_id = auth.uid())` impede postar em nome de outra pessoa.
- [x] Politica de `profiles` para `UPDATE` é defensiva em três frentes: admin pode tudo; pastor **não** mexe em admin (`not (roles && array['administrador'])`), **não** se promove (`id <> auth.uid()` no `with check`) e **não** concede `administrador` a ninguém.
- [x] `profiles_roles_check` restringe `roles` às 7 perfis conhecidas com `cardinality(roles) > 0`.
- [x] `saidas_caixa` é a policy mais bem escrita do projeto: separa quem registra de quem apaga, e amarra a escrita a `caixas.status = 'aberto'` com `EXISTS`.

### 🔴 Crítica — `agenda_igreja`: as policies mentem no nome

`supabase/20260920_melhorias_administrativas.sql:31-33`

```sql
create policy "Secretaria e administradores criam agenda" on public.agenda_igreja
  for insert to authenticated with check (true);
create policy "Secretaria e administradores atualizam agenda" on public.agenda_igreja
  for update to authenticated using (true) with check (true);
create policy "Secretaria e administradores excluem agenda" on public.agenda_igreja
  for delete to authenticated using (true);
```

O nome promete "Secretaria e administradores". O corpo é `true`. **Qualquer usuário autenticado — inclusive perfil `membro` — pode criar, alterar e apagar qualquer evento da agenda**, incluindo o de outro usuário. Verifiquei que nenhuma migration posterior substitui essas três policies; `role_em()` foi criada em `20260925` "para compatibilidade com as policies de agenda", mas nunca foi conectada a elas.

Isso não é SQL Injection, é o oposto: falta de injeção. A UI pode esconder o botão, mas a API aceita.

**Correção:**
```sql
drop policy if exists "Secretaria e administradores criam agenda" on public.agenda_igreja;
create policy "Secretaria e administradores criam agenda" on public.agenda_igreja
  for insert to authenticated
  with check (public.tem_perfil(array['administrador','secretaria','pastor']::text[]));

drop policy if exists "Secretaria e administradores atualizam agenda" on public.agenda_igreja;
create policy "Secretaria e administradores atualizam agenda" on public.agenda_igreja
  for update to authenticated
  using (public.tem_perfil(array['administrador','secretaria','pastor']::text[]))
  with check (public.tem_perfil(array['administrador','secretaria','pastor']::text[]));

drop policy if exists "Secretaria e administradores excluem agenda" on public.agenda_igreja;
create policy "Secretaria e administradores excluem agenda" on public.agenda_igreja
  for delete to authenticated
  using (public.tem_perfil(array['administrador','secretaria','pastor']::text[]));
```

> **Risco de aplicar:** não tenho como saber se o app usa `pastor` para editar a agenda. Se hoje qualquer usuário edita e isso foi usado de verdade, o corte vai quebrar o fluxo. Teste com o perfil `membro` antes de deployar.

### 🟠 Alta — 6 tabelas sem RLS versionado

O front-end acessa 14 tabelas. O repositório versiona policy para 7. **Não existe nenhuma policy no repositório para:**

| Tabela | Sensibilidade |
|---|---|
| `vendas_arrecadacao` | 🔴 **Dinheiro** — todas as vendas e fiados |
| `itens_venda_arrecadacao` | 🔴 **Dinheiro** — os itens de cada venda |
| `caixas` | 🔴 **Dinheiro** — aberturas, fechamentos, diferenças |
| `confirmacoes_membros` | 🟠 Alto — pedidos de confirmação de membro |
| `lecionario` | 🟡 Médio — dados de contato deministrantes |
| `postagens` | 🟡 Médio — communication da igreja |

O próprio projeto admite a lacuna em `20260926_saidas_e_reabertura_caixa.sql:54`:

> `-- as tabelas caixas/vendas_arrecadacao não têm RLS versionado aqui; esta é a primeira do módulo com política explícita.`

Como o front-end escreve direto nestas tabelas (`.insert()`, `.update()`, `.delete()`), **se o RLS não estiver ativo no banco, qualquer pessoa com a chave `anon` — sem login — lê e altera os dados financeiros de toda a igreja.** A chave `anon` é pública por design; a única coisa que protege essas tabelas é o RLS.

Não posso afirmar que o RLS está desligado: ele pode ter sido aplicado direto no Dashboard e nunca versionado. **Mas isso é exatamente o problema** — política de segurança que não está no repositório não é auditável, não é revisável e não sobrevive a um novo ambiente.

**O que fazer, em ordem:**

1. Rodar no SQL Editor e colar o resultado aqui:
```sql
select c.relname as tabela,
       c.relrowsecurity as rls_ativo,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;
```
2. Para toda tabela com `rls_ativo = false`, ativar e criar as policies.
3. Versionar o resultado como migration, seguindo o padrão de `saidas_caixa`.

Como referência, o padrão que o resto do projeto usa:
```sql
alter table public.vendas_arrecadacao enable row level security;

create policy "Caixa lê vendas" on public.vendas_arrecadacao
  for select to authenticated
  using (public.tem_perfil(array['administrador','secretaria','caixa','tesouraria','pastor']::text[]));

create policy "Caixa registra vendas" on public.vendas_arrecadacao
  for insert to authenticated
  with check (public.tem_perfil(array['administrador','caixa','tesouraria']::text[]));
```

### 🟡 Média — `profiles` expõe e-mail de todo mundo

`20260925_roles_multiplas_e_feed.sql:147` — `USING (true)` no SELECT, e o serviço lista todos os perfis:

```ts
// supabase.service.ts:536
.select('id, roles, nome, email, criado_em, atualizado_em')
```

Qualquer usuário autenticado, inclusive `membro`, pode puxar **nome, e-mail e perfis de todos os usuários** da igreja. A tela de gerenciamento de usuários é restrita por `UPDATE`, mas a *leitura* não é. Dado pessoal (e-mail) exposto a quem não deveria.

**Correção:** criar uma view ou policy separada para o caso de uso legítimo (o admin precisa listar), e restricting a coluna `email` ao próprio usuário + administradores.

### Existe cenário de acessar dados de terceiros?

Sim, dois:

- `agenda_igreja`: qualquer autenticado edita/apaga evento de qualquer pessoa (🔴 acima).
- `profiles`: qualquer autenticado lê e-mail de qualquer pessoa (🟡 acima).

Fora isso, o isolamento por pasta no Storage (`(storage.foldername(name))[1] = auth.uid()::text`) e o `autor_id = auth.uid()` do feed estão corretos.

---

## 2. Funções do banco (RPC)

### O que está certo

- [x] **Nenhum SQL dinâmico com entrada de usuário.** O único `EXECUTE` é `execute $migra$` em `20260925_roles_multiplas_e_feed.sql:31`, com texto **constante** — não concatena variável. Os demais `execute` são `grant execute` e `execute function` de trigger. **Não há superfície de SQL Injection via RPC.**
- [x] **Todo `SECURITY DEFINER` tem `set search_path`.** Verifiquei os 12: todos definem `set search_path = public` ou `'public'`. Isso é o que fecha o ataque de *function hijacking* ( Shadow Functions ), em que um usuário cria uma função com o mesmo nome em outro schema. As 3 ocorrências de "FALTA" na minha varredura automática eram comentários, não código.
- [x] Funções de caixa validam o papel **dentro** da função (`raise exception`), e não só via policy.
- [x] `reabrir_caixa` tem três travas concordantes: perfil, nenhum caixa aberto e só o caixa mais recente. A observação é **obrigatória** (`nullif(trim(coalesce(...)))`), o que impede reabertura silenciosa.
- [x] `revoke all ... from public` + `grant execute ... to authenticated` presentes em `reabrir_caixa`, `atualizar_meu_nome` e `atualizar_meu_foto`.
- [x] `atualizar_meu_nome` e `atualizar_meu_foto` restringem a escrita com `where id = auth.uid()` — o usuário só edita a si próprio, sem passe de admin.

### 🔵 Baixa — endurecimento inconsistente nas funções de caixa

`abrir_caixa`, `fechar_caixa`, `tem_perfil`, `is_admin` e `role_em` **não** têm `revoke`/`grant`. Em Postgres, funçõesilen`public` recebem `EXECUTE` de `PUBLIC` por padrão — ou seja, **são executáveis também por `anon`**, sem login.

Não é exploitable: `tem_perfil` consulta `auth.uid()`, que é `null` para anônimo, e a função levanta exceção. Mas é defesa que depende de o check interno estar certo sempre. O padrão `revoke`/`grant` já existe no projeto — só não foi aplicado aqui.

```sql
revoke all on function public.abrir_caixa(numeric, text) from public;
grant execute on function public.abrir_caixa(numeric, text) to authenticated;
-- idem para fechar_caixa, tem_perfil, is_admin, role_em
```

### 🔵 Baixa — `tocar_atualizado_em` sem `search_path`

`20260925_roles_multiplas_e_feed.sql:234`. Não é `SECURITY DEFINER`, então o risco é baixo, mas por consistência com o resto:
```sql
create or replace function public.tocar_atualizado_em() ... set search_path = public as $$ ...
```

### 🟡 Média — `atualizar_meu_foto` não valida nada

`20260925_storage_avatars.sql:91`. Aceita qualquer texto e grava em `profiles.foto`, que é renderizado em `<img src>`. O irmão `atualizar_meu_nome` valida (`char_length(trim(...)) < 2`). Aqui não há check nenhum: o usuário pode apontar `foto` para uma URL externa arbitrária (pixel de rastreamento, domínio de terceiros) ou para `avatars/<outro_user_id>/x.png`.

As tabelas do feed e da agenda resolvem isso com check constraint no banco:
```sql
check (imagem_url ~ '^https://[^/]+/storage/v1/object/public/postagens/')
```
`profiles.foto` ficou de fora dessa proteção. **Recomendo o mesmo check.**

---

## 3. Vazamento de credenciais

### O que está certo

- [x] **`service_role` não existe** em nenhum arquivo do projeto — confirmei no código, nos 15 SQL, no `package.json` e **no histórico completo do git** (`git log -p -S service_role`): zero ocorrências.
- [x] **Apenas a chave `anon` está exposta.** Decodifiquei o JWT de `environments.development.ts:3`:
  ```json
  {"iss":"supabase","ref":"cpnlcjwgwaaeptyudzec","role":"anon", ...}
  ```
  É a chave `anon`. Isso é o desenho do Supabase: a `anon` é pública por definição, e a segurança inteira depende do RLS estar correto. Como o RLS das tabelas de dinheiro não é verificável (achado 🟠), essa é a fragilidade real da aplicação.
- [x] Nenhum arquivo `.env`, `secret`, `*.pem` ou `*.key` versionado.
- [x] Nenhum `innerHTML`, `bypassSecurityTrust`, `document.write` ou `outerHTML` — **sem sink de XSS**.
- [x] `persistSession` em `localStorage` é o padrão do `@supabase/supabase-js`; o token é do próprio usuário, não um segredo do servidor.

### 🟡 Média — `.gitignore` não protege `environments`

`.gitignore` não menciona `.env` nem `environments`. Dois problemas:

1. `environments.development.ts` está versionado com URL e chave `anon` reais. A `anon` não é segredo, mas versionar chave no repositório é mau hábito e polui o diff.
2. **O `mynode.js` do `npm start` reescreve `environments.development.ts` a partir de `src/.env`.** Se alguém criar `src/.env` com uma chave `service_role` para uma tarefa local e commitar sem perceber, **o serviço inteiro vaza para o GitHub**. Isso não é teórico: o `src/.env` não existe hoje, e o script grava `undefined` quando ele falta — o que já quebrou sua sessão uma vez nesta sessão.

**Correção:**
```gitignore
# .env
src/.env
.env
```
E, para o ambiente de produção, `src/environments/environments.ts` está com as três variáveis **vazias** (arquivo versionado). Isso significa que o build de produção precisa de injeção de config no build, e não há `.env` nem `config.toml` no projeto para fazer isso. Se hoje a chave de produção entra por edição manual do arquivo, ela está em risco no próximo commit — e mais uma vez não há proteção.

---

## 4. Validação de dados e lógica de entrada

### O que está certo

- [x] **Não há injeção de filtro no PostgREST.** Varri `.or()`, `.filter()`, `.ilike()`, `.like()`, `.match()` e `.textSearch()`: os 10 hits de `.filter(` são `Array.prototype.filter` do JavaScript, e as outras APIs têm **zero** ocorrências. Nenhuma interpolação de string entra em filtro de query. Vale manter assim.
- [x] **As operações críticas de dinheiro já foram para o banco.** `abrir_caixa`, `fechar_caixa` e `reabrir_caixa` são RPC `SECURITY DEFINER` com validação interna — que é a arquitetura correta. O cálculo de conferência (`valor_abertura + vendas_em_dinheiro - saidas_efetivas`) acontece no Postgres, não no cliente, então não é manipulável.
- [x] **Constraint de banco contra URL maliciosa** em `feed_publicacoes.imagem_url` e `agenda_igreja.imagem_url`, bloqueando `javascript:` e `data:`.
- [x] Validação de domínio no banco: `saidas_caixa.valor > 0`, `troco >= 0 and troco <= valor`, `fiado_deve_ter_membro`, `feed_publicacoes.conteudo` não vazio.

### O que pode melhorar

- [ ] **Não há biblioteca de validação de schema** (nem zod, nem yup, nem ajv) — confirmei no `package.json`. Toda a validação de entrada está no Postgres, via constraint e policy. Isso é aceitável porque o Postgres é a fronteira de verdade e valida sempre, **mesmo** com `curl`. Mas o usuário recebe erro em vez de validação amigável, e o front-end pode enviar payload inválido e ficar sem saber por quê.
- [ ] **Toda a lógica de negócio está no front-end.** O front-end lê o caixa inteiro, filtra por perfil, agrupa por membro e calcula totais. Isso é apresentação — aceitável. Mas significa que **qualquer regra que só existe no TypeScript é decorativa**: ela não protege nada, porque o atacante não passa pela sua UI. Vale revisar se alguma regra importante só existe no cliente e colocar a garantia no Postgres.
- [ ] **`profiles` perdeu a policy de INSERT sem querer.** `20260925_roles_multiplas_e_feed.sql:13` dropa "Somente admin insere perfis" e a seção 7 só recria SELECT e UPDATE. O resultado é *fail-closed* (ninguém insere perfil pelo cliente, e `handle_new_user` é `SECURITY DEFINER`), então **não é vulnerability** — e o front-end hoje só faz `select` e `update` em `profiles`, então não quebra nada. Mas a intenção ficou ambígua: foi consciente? Vale comentar a decisão na migration.
- [ ] **Rotas e telas são protegidas no cliente.** O `auth.guard` decide no navegador, o que é normal em SPA e **não é** fronteira de segurança. A proteção real precisa ser RLS — reforçando o achado 🟠.

---

## Ordem de ação sugerida

1. 🔴 Rodar o diagnóstico de RLS (query no achado 🟠) e corrigir `agenda_igreja` com as policies acima.
2. 🟠 Versionar as policies de `vendas_arrecadacao`, `itens_venda_arrecadacao`, `caixas`, `confirmacoes_membros`, `lecionario`, `postagens`.
3. 🟡 Adicionar `src/.env` e `.env` ao `.gitignore`.
4. 🟡 Restringir a leitura de `profiles` / proteger a coluna `email`.
5. 🟡 Check constraint em `profiles.foto` no mesmo padrão do feed.
6. 🔵 `revoke`/`grant` em `abrir_caixa`, `fechar_caixa`, `tem_perfil`, `is_admin`, `role_em`.

---

## Limitações desta auditoria

- **Não há conexão com o banco.** Tudo aqui vem dos 15 arquivos em `supabase/`. O RLS realmente ativo no projeto pode ser diferente do versionado — e, pelas evidências, é provável que seja: as tabelas de dinheiro foram criadas fora deste repositório.
- **Não há histórico de migrations completo.** Os arquivos começam em `20260920`. Não sei como `vendas_arrecadacao` e `caixas` foram criadas nem quais policies já existiam antes.
- **Não há Edge Functions** (`supabase/functions/` não existe) nem `config.toml`. Se existissem em outro repositório, não foram auditadas.
- **A migração de RLS das tabelas de dinheiro é a maior lacuna desta auditoria.** Enquanto ela não for versionada, nenhuma afirmação sobre a segurança dos dados financeiros é possível — nem por mim, nem por qualquer revisor futuro.
