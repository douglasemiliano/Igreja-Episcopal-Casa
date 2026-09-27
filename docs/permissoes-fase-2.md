# Permissões dinâmicas — fase 2

> O que a `20260927_permissoes_dinamicas.sql` deixou pela metade, e o que foi
> feito para fechar. Documento de decisão: cada escolha aqui tem um "porquê" e
> um "como desfazer".
>
> Contexto geral e desenho: `permissoes-dinamicas-plano.md`.

---

## 1. O problema

A primeira migration criou o catálogo, a função `pode()` e a tela
`/permissoes`. Ela trocou `tem_perfil()` por `pode()` em **duas** tabelas:
`agenda_igreja` e o `DELETE` de `feed_publicacoes`.

As outras treze chaves do catálogo continuavam deciding o acesso no banco pela
lista escrita à mão em `public.tem_perfil(array[...])`. A tela `/permissoes`
edia essas chaves, e mexer nelas não mudava nada no banco.

O risco, concreto: o administrador revoga `operar_arrecadacoes` de `caixa` na
tela. Os botões somem. A policy de `saidas_caixa_insert` continua aceitando
`caixa`, porque ainda consulta `tem_perfil`. Uma chamada direta ao REST com o
token da pessoa continua passando.

É o modo de falha que a seção 2 do plano já descrevia — *"a configuração vira
um botão de mentira"* — e que valia para treze chaves.

---

## 2. O critério de escopo

A primeira tentação seria migrar tudo de uma vez. Isso seria erro.

Uma policy que consulta `pode()` sem que o front cheque a mesma chave produz o
problema inverso: **o botão aparece e o banco recusa**. O usuário clica em
"Salvar", recebe um erro de permissão sem explicação, e a tela parece quebrada.

Por isso o escopo da fase 2 é: **só as operações que já tinham uma chave no
catálogo E já eram checadas no front.** São sete. Migrar essas não muda nada
para o usuário, e é onde a tela já está correta.

### As sete operações

| # | Onde | Chave | Correspondência |
| --- | --- | --- | --- |
| 1 | `feed_publicacoes` INSERT | `publicar_publicacao` | exata |
| 2 | `membros` INSERT | `cadastrar_membros` | **corrigida** — ver seção 3 |
| 3 | `registros_batismo` INSERT | `registrar_batismo` | **corrigida** — ver seção 3 |
| 4 | `profiles` UPDATE | `gerenciar_usuarios` | exata, com regra por linha |
| 5 | `saidas_caixa` SELECT | `ver_relatorios_caixa` | exata |
| 6 | `saidas_caixa` INSERT e UPDATE | `operar_arrecadacoes` | exata |
| 7 | `reabrir_caixa` (RPC) | `reabrir_caixa` | exata |

Cinco correspondências exatas: a lista de papéis da chave é idêntica à lista
que a policy exigia. Mover o corpo para `pode()` não muda quem entra.

O que **não** mudou em lugar nenhum: acesso. Ninguém ganhou nem perdeu nada
nessas sete operações.

### Regras de negócio preservadas

Duas conditions não são permissão e foram mantidas intactas:

**`saidas_caixa`, caixa aberto.** O `INSERT` e o `UPDATE` exigem que o caixa
referenciado esteja com `status = 'aberto'`. Isso é regra de negócio — não se
lança saída em caixa fechado — e continua ao lado do `pode()`.

**`feed_publicacoes`, autoria.** O `INSERT` continua exigindo
`and autor_id = auth.uid()`. `pode()` responde "este papel pode publicar"; não
sabe nada sobre a linha. Publicar no mural de outra pessoa não é a mesma coisa
que publicar no próprio.

**`profiles`, regras por linha.** A chave `gerenciar_usuarios` cobre o nível de
papel, e as duas travas de linha seguem ao lado dela: o pastor não altera
perfil de administrador nem o próprio perfil. Uma policy com só `pode()`
devolveria ao pastor exatamente as duas coisas que a policy anterior proibia.

O efeito colateral disso é bom. Como a regra por linha continua valendo,
conceder `gerenciar_usuarios` a outro papel pela tela o habilita **sem** dar
poder sobre administrador nem sobre a própria conta. A configuração passa a
alcançar combinações que a lista fixa de dois papéis não expressava.

---

## 3. As duas correções de concessão

A migração original semeou `cadastrar_membros` e `registrar_batismo`
copiando os arrays do **front**. O front permitia; a policy da tabela nunca
permitiu:

```
cadastrar_membros    policy:  tem_perfil(['administrador','secretaria'])
                     catálogo: administrador, secretaria, pastor

registrar_batismo    policy:  tem_perfil(['administrador','secretaria'])
                     catálogo: administrador, secretaria, pastor
```

Aplicar `pode()` sem corrigir isso daria **acesso de escrita em membros e em
registros de batismo ao pastor** — que hoje é bloqueado. E nenhuma das duas
pessoas envolvidas teria decidido isso: eu, escrevendo a migration, e a
igreja, usando a tela.

A correção é `delete` da linha `(chave, 'pastor')`, e o efeito no front é o
pastor deixar de ver `/membros/cadastrar` e `/livro/batismo/cadastro`. Isso
parece uma perda de acesso, mas é o contrário: é a tela parando de prometer
uma coisa que o banco já negava. O pastor não conseguia cadastrar membro
— o formulário abria e o `INSERT` voltava com erro de permissão. Agora o
formulário não abre.

**Se a igreja decidir que o pastor deve cadastrar membros e registrar
batismos**, é uma linha, e o front já está preparado para isso:

```sql
insert into public.permissoes_roles (chave, role)
values ('cadastrar_membros', 'pastor')
on conflict do nothing;
```

Essa é a decisão que precisa ser tomada por alguém da igreja, e não por quem
escreve SQL. A escolha segura foi preservar o banco e registrar a divergência.

---

## 4. O que ficou de fora, e por quê

### 4.1 Tabelas sem RLS — não tocar às cegas

`caixas`, `vendas_arrecadacao`, `itens_venda_arrecadacao` e `lecionario` não
têm `enable row level security` em nenhum script do repositório. A própria
migration das saídas admite isso em `20260926_saidas_e_reabertura_caixa.sql:54`:

> as tabelas caixas/vendas_arrecadacao não têm RLS versionado aqui; esta é a
> primeira do módulo com política explícita

Duas razones para não incluí-las agora:

1. **Risco de indisponibilidade.** `alter table ... enable row level security`
   em uma tabela sem nenhuma policy bloqueia a leitura para **todo mundo**,
   inclusive o administrador. Se essas tabelas estão como o repo sugere, a
   tela de caixa e de relatórios sai do ar na hora.
2. **O estado real delas é desconhecido.** Se existirem policies, foram
   criadas direto no Dashboard do Supabase. Não estão versionadas, não são
   cobertas por rollback e ninguém as revisou. Ligar RLS em cima delas sem
   saber o que existe é atravessar no escuro.

O que fazer, em ordem: rodar `20260927_diagnostico_rls.sql` (somente leitura),
olhar o que a seção 1 dele(reporta), e só então escrever a migration
correspondente.

### 4.2 Operações sem chave no catálogo

Cinco operações continuam decididas por `tem_perfil`, e não por falta de
vontade: **não existe chave que descreva o que elas fazem.**

| Operação | Quem pode hoje | Chave que falta |
| --- | --- | --- |
| abrir e fechar caixa | administrador, tesouraria | `gerenciar_caixa` |
| excluir saída de caixa | administrador, tesouraria | `excluir_saida_caixa` |
| editar / excluir membro | administrador, secretaria | `editar_membros`, `excluir_membros` |
| editar / excluir livro | administrador, secretaria | `editar_livros`, `excluir_livros` |
| editar / excluir batismo | administrador, secretaria | `editar_batismo`, `excluir_batismo` |

Duas rejeições que valem registro, porque a tentação vai ser usar uma chave
que existe:

**`operar_arrecadacoes` para abrir e fechar o caixa.** A chave é concedida a
administrador, caixa, tesouraria e pastor. As funções de abertura e fechamento
exigem só administrador e tesouraria. Usar essa chave daria a `caixa` e ao
`pastor` o poder de abrir a gaveta — que é o tipo de acesso que não se
concede por accident de nome de variável.

**`reabrir_caixa` para excluir saída de caixa.** As duas coisas são
administrador e tesouraria, exatamente o mesmo par. Mas uma chave que se
chama "reabrir caixa" e controla a exclusão de uma saída é uma mentira na
telinha da tela de configuração. O administrador que lê `/permissoes` precisa
saber o que está mexendo.

Quando essas chaves forem criadas, o trabalho de duas etapas é:

1. Semear a chave com a lista de papéis que a operação exige **hoje** — nunca
   com uma lista nova. É o que garante que a fase 3 não vire escalonamento.
2. Ligar a chave ao botão, no componente. Sem isso, botão que aparece e o
   banco recusa.

### 4.3 Chaves que são só portão de navegação

`ver_central` e `ver_dashboard` não têm tabela para amarrar: são índices de
atalhos e uma tela de indicadores. Não há o que proteger no banco, e fingir que
há seria encher o catálogo de chaves que não controlam nada.

`emitir_certificado` é o mesmo caso, por um motivo menos óbvio: a tela gera o
PDF no navegador (html2canvas) e não escreve em tabela nenhuma. A chave
protege a rota, e está correto que proteja só a rota.

---

## 5. Como aplicar

Na ordem. Os passos 1 e 2 são independentes, mas o 3 pressupõe os dois.

**1. Diagnóstico, antes de tudo.** Cole a saída num arquivo versionado, junto
com a data:

```powershell
# salvar como docs/diagnostico-rls-antes-2026-09-27.txt
```

Rodar `supabase/20260927_diagnostico_rls.sql` no SQL Editor. Não altera nada.

**2. A migration.**

```
supabase/20260927_permissoes_policies_restantes.sql
```

**3. Diagnóstico de novo, e comparar.** As três queries da seção 10 da
migration são a conferência. A que importa:

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and cmd in ('insert', 'update', 'delete')
  and (qual like '%tem_perfil%' or with_check like '%tem_perfil%')
order by tablename, cmd;
```

Esperado: só `membros` e `registros_batismo` (UPDATE e DELETE), `livros` (as
três) e `saidas_caixa_delete`. Todas as sete operações da seção 2 precisam ter
sumido da lista.

**4. Teste de comportamento**, com o token de um papel **sem** a permissão,
contra o REST direto. Se passar, a tela ainda está mentindo:

```
POST /rest/v1/saidas_caixa
Authorization: Bearer <token de secretaria — que tem ver_relatorios_caixa mas não operar_arrecadacoes>
```

Secretaria é o teste bom aqui: ela lê saídas e não lança. Se o `POST` voltar
`401` ou `403`, a policy está valendo.

### Desfazer

```
supabase/20260927_permissoes_policies_restantes_rollback.sql
```

Os corpos restaurados vêm dos arquivos de origem, citados no cabeçalho do
rollback — não de memória. Não é preciso reverter o front: nenhuma chave sai
do catálogo, e os botões que sumiram voltam sozinhos com a concessão de volta.

Para desfazer as permissões dinâmicas inteiras, e não só esta fase:
`20260927_permissoes_dinamicas_rollback.sql`.

---

## 6. O que ainda está aberto

| Item | Risco se ficar | Custo de fechar |
| --- | --- | --- |
| `caixas`, `vendas_arrecadacao`, `lecionario` sem RLS | tabela inteira legível por qualquer autenticado | médio — precisa do diagnóstico primeiro |
| 5 operações sem chave (seção 4.2) | tela sem controle sobre elas | médio — chave + botão |
| `membros` e `livros` UPDATE/DELETE sem RLS por chave | escrita livre entre quem já tem acesso | baixo no banco, mas exige botão no front |
| `CHECK` em `permissoes_roles.role` | concessão para papel inexistente passa em silêncio | baixo, e só quando a lista de papéis estabilizar |
| `abrir_caixa` / `fechar_caixa` ainda em `tem_perfil` | dentro do item "5 operações" | — |

O item mais caro é o primeiro. Uma tabela sem RLS é lida por qualquer
autenticado — inclusive uma tabela de caixa, que é dado financeiro da igreja.
Esse deveria ser o próximo passo, e não uma questão de estética: porque uma
tela que não tem controle sobre nada é um incômodo, e uma tabela de finanças
que qualquer membro logado pode ler é um incidente.
