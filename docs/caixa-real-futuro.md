# O caixa de hoje e o caixa real da igreja

Este documento é um rascunho de rota. Ele existe para registrar **por que o
caixa das ações é simples**, e o que precisaria mudar para o sistema passar a
cuidar do dinheiro da igreja inteira.

Nenhuma das mudanças descritas aqui está implementada. Este arquivo é
referência, não tarefa.

---

## 1. O que o sistema cuida hoje

O `Caixa` (tela `/acoes`) é o caixa de **uma ação específica**: bazar,
hamburgada, feijoada. Ele responde a uma pergunta estreita:

> "Quanto essa ação deixou para a igreja?"

Três coisas são verdadeiras hoje porque disso decorre:

- **Não existe tabela de dívida.** O fiado é a própria venda, com
  `forma_pagamento = 'fiado'` e `status = 'pendente'`. Quitar significa
  sobrescrever a forma de pagamento.
- **Não existe histórico de fechamentos.** Uma linha em `caixas` por turno.
  Reabrir e fechar de novo substitui o fechamento anterior.
- **Não existe livro-razão.** Não dá para pagar um fiado em duas parcelas nem
  registrar a diferença entre o preço e o que foi pago.

Isso foi uma decisão, não uma limitação esquecida. O público é quem está
vendendo cachorro-quente com uma mão e a maquine na outra. Cada clique extra
custa uma venda não registrada.

---

## 2. Por que isso não serve para o caixa real

O caixa da igreja tem três movimentos que o de ações não tem.

### 2.1 Entradas que não são venda

Dízimo, ofertas, dízimos, vendas de bens, doações. Nenhuma delas é "produto ×
quantidade em uma ação".

No modelo atual elas não têm onde entrar. Ou seja: ou se cadastra como venda
de uma ação que não existiu, ou fica no sistema de contabilidade separado,
sem nenhuma ligação com o caixa.

### 2.2 Saídas que não são insumo

Conta de luz, água, limpeza, salary, assistente, dízimo repassado, compra de
equipamento. Hoje a `saidas_caixa` existe, mas ela está presa a um `caixa_id`
de ação: **não dá para lançar uma conta de luz**, porque não existe caixa
aberto, e mesmo que existisse, a saída apareceria dentro do turno de uma
ação.

### 2.3 Tempo

O caixa real é contínuo: abre de manhã, fecha de noite, todo dia. O caixa de
ação abre e fecha algumas vezes por mês. São ciclos diferentes.

---

## 3. O que precisaria mudar

### 3.1 Um livro-razão, não um total por turno

Hoje o total é calculado somando vendas. Quando alguém pagar um fiado de
semana passada, o valor entra na venda antiga, e o caixa de ontem muda de
número depois de já ter sido conferido.

A correção estrutural é separar **o que foi vendido** de **quando o dinheiro
entrou**:

```
vendas              o que a igreja vendeu, com data e categoria
pagamentos          cada dinheiro que entrou, com data e forma
```

Com as duas tabelas:

- o **caixa de um dia** é a soma dos pagamentos daquele dia;
- a **receita** é a soma das vendas, independentemente de quando foram pagas;
- um fiado pago em abril aparece em abril, e não corrige abril retroativa.

Essa mudança também resolve, de passagem, o problema do histórico do membro:
com `pagamentos` separado, o histórico de uma pessoa é a soma dos pagamentos,
não das vendas marcadas como "fiado".

**Custo:** a confirmação de um fiado deixa de ser um `update` na venda e vira
um `insert` em `pagamentos`. Sai também a noção de "fiado pago", que passa a
ser "venda com payments < total".

### 3.2 Um caixa sem ação

`caixas` hoje significa "turno de uma ação". Para o caixa real, o equivalente é
uma `sessoes_caixa` com data de abertura e fechamento, sem `categoria`. As
vendas de ação continuam pertencendo a um turno de ação; as entradas e saídas
gerais pertencem a uma sessão de caixa.

Na prática são duas coisas parecidas com nomes diferentes, e o erro de
modelar as duas com a mesma tabela é jogar `categoria = 'conta de luz'` em
`vendas_arrecadacao`.

### 3.3 Classificação das saídas

Hoje a saída é livre e genérica, o que é correto para "comprei frango na
hora". Para o caixa real a saída precisa de uma **categoria** (`insumos`,
`fixo`, `manutencao`, `pessoal`, `imposto`), porque sem isso não há como
responder "quanto gastamos com manutenção neste ano".

Não é a mesma coisa que a categoria da venda, e não deve ser a mesma coluna.

### 3.4 Abertura de caixa com saldo anterior

O caixa de ação assume que a gaveta começa com o troco que você digitou. No
caixa real o saldo é o que sobrou do dia anterior, e ele **precisa** ser
exato. Isso pede uma restrição forte no banco: não pode abrir uma sessão
com `valor_abertura` diferente do `valor_fechamento` da anterior.

Hoje essa regra não existe, e nada impede alguém de abrir um caixa com
`valor_abertura` errado e "consertar" depois.

### 3.5 Concorrência

A regra "só existe um caixa aberto" é verificada dentro da RPC, o que é
suficiente para uma igreja. Num sistema com vários usuários em vários
dispositivos ao mesmo tempo, ela vira uma restrição única no banco
(`create unique index ... where status = 'aberto'`).

Vale a pena desde já, porque a verificação em RPC depende de todos os
caminhos de escrita passarem pela RPC.

---

## 4. O que **não** muda

Para não cair na armadilha de refazer tudo:

- **Venda continua sendo venda.** Produto, quantidade, preço, ação, data.
- **Ação continua sendo ação.** Bazar, hamburgada, feijoada, com o nome que a
  igreja usa.
- **Membro continua sendo membro.** O fiado sempre vai precisar de um nome.
- **Caixa por turno continua existindo.** Só deixa de ser a única unidade de
  conciliação.

---

## 5. Ordem sugerida, se um dia for preciso

Do que menos quebra para o que mais quebra:

1. **`pagamentos`** como tabela separada, sem mudar nenhuma tela. O caixa
   atual continua funcionando, e o fiado passa a ter um histórico.
2. **`sessoes_caixa`** para o caixa real, com as entradas e saídas gerais.
   As vendas de ação seguem como estão.
3. **Categoria nas saídas**, quando alguém precisar do relatório anual.
4. **Abertura com saldo travado**, junto com o índice único de caixa aberto.

O passo 1 é o que destrava o resto. Os outros três são aditivos e podem
esperar.

---

## 6. Uma ressalva

Nada aqui é posição da equipe da tesouraria. Este documento foi escrito a
partir de como o sistema se comporta hoje, e serve para conversar com quem
cuida do dinheiro da igreja — não para decidir por essa pessoa.
