# Como operateir o caixa

Guia do dia a dia para quem vai cuidar do caixa de uma ação da igreja.
Não é documentação de sistema: é o passo a passo de quem está com o dinheiro
na mão na hora da hamburgada, do bazar ou da feijoada.

---

## O que é um "caixa"

Um caixa é um **turno**. Ele começa quando alguém abre e termina quando
alguém fecha.

Todas as vendas do caixa ficam ligadas a ele. Isso é o que permite,
depois, olhar um turno antigo e saber o que aconteceu.

---

## Antes de começar: quem pode

| Ação | Quem pode |
|---|---|
| Abrir caixa | administrador, tesouraria |
| Registrar venda | administrador, caixa, tesouraria, pastor |
| Registrar saída | administrador, caixa, tesouraria, pastor |
| Editar saída | administrador, caixa, tesouraria, pastor |
| Excluir saída | administrador, tesouraria |
| Fechar caixa | administrador, tesouraria |
| Reabrir caixa | administrador, tesouraria |

---

## 1. Abrir o caixa

1. Em **Caixa**, vá na aba **Registrar**.
2. Clique em **Abrir caixa**.
3. Se já houver troco na gaveta, escreva em **Troco inicial na gaveta**.
4. **Abrir caixa**.

> O troco inicial não é lucro da ação. Ele só existe para a conferência da
> gaveta fechar no final. Se a gaveta começou vazia, deixe `0,00`.

Só existe **um** caixa aberto por vez. Se a tela mostrar que já existe um
caixa aberto, feche aquele primeiro.

---

## 2. Registrar vendas

Na aba **Registrar**:

1. Escolha a **ação** (Bazar, Hamburgada ou Feijoada).
2. Escolha a forma de pagamento.
3. Preencha a lista de itens e toque em **Adicionar**.
4. **Registrar venda**.

### Sobre o fiado

Para lançar no fiado, é obrigatório escolher o **membro** que está devendo.
Sem membro o sistema não aceita, porque não existe dívida de ninguém anônimo.

### O fiado aparece por venda

Na aba **Fiado em aberto**, cada linha é **uma venda**. A linha mostra só o
total; os itens ficam escondidos até você clicar em **Ver detalhes**.

- clique na linha para abrir os itens e ver o que foi pedido;
- **Excluir item** remove só aquele item, se foi lançado errado ou a pessoa
  desistiu. Dá para excluir enquanto a venda está em aberto;
- **Marcar venda como paga** quita aquela venda. Escolha se foi em dinheiro,
  Pix, débito ou crédito.

### A venda é do caixa onde foi feita

Se a pessoa também estiver devendo de **outro dia**, aparece um aviso
explicando isso, e a venda do outro dia fica separada.

Isso é de propósito. O dinheiro de uma venda pertence ao caixa onde ela foi
feita: se a Ana pagar no domingo, esse valor entra no caixa de sábado, e é por
isso que o caixa de sábado precisa ser reaberto para receber a quitação. Se as
vendas fossem misturadas, a conferência da gaveta de um caixa passaria a
depender de dinheiro de outro.

---

## 3. Registrar saída de caixa

Sai dinheiro da gaveta quando é preciso comprar algo: frango, gelo, pão,
embalagem. Não é o mesmo que pagar uma conta da igreja.

1. Vá na aba **Resumo**.
2. Clique em **Registrar saída**.
3. Informe **quanto saiu do caixa**.
4. Se voltou troco, informe em **Troco que voltou**.
5. Escreva o **motivo**.
6. **Registrar saída**.

### O detalhe do troco

Se você tira R$ 100 para comprar e volta com R$ 12 de troco, o gasto foi de
**R$ 88**, não R$ 100. O sistema calcula isso sozinho e o preview mostra o
valor antes de você confirmar.

O motivo fica registrado e aparece no resumo, no PDF e no Excel. "Comprou
frango" é suficiente; não precisa escrever conta de luz.

### Gastou menos do que tirou: edite a saída

Acontece muito: você tira R$ 30 do caixa para comprar, gasta só R$ 20 e os
R$ 10 voltaram para a gaveta. A saída continua sendo de R$ 30, mas o que
interessa para a conferência é o **gasto**, não o que foi pego.

Para corrigir, na aba **Resumo**, na lista de saídas, clique em **Editar** no
card vermelho da saída. O modal abre com os valores atuais e você ajusta:

- se os R$ 10 voltaram como troco, informe em **Troco que voltou**;
- se você só quer registrar o que realmente saiu, corrija o **valor**;
- o preview mostra o quanto sai da gaveta antes de salvar.

Nada é apagado: a saída original vira a saída corrigida, e o sistema guarda quem
corrigiu e quando. A edição só é possível com o caixa aberto — caixa fechado
pede reabertura.

As saídas aparecem com **fundo vermelho claro e texto vermelho** para o olho
achar rápido na lista.

---

## 4. Fechar o caixa

1. Vá na aba **Resumo**.
2. Clique em **Fechar Caixa**.
3. **Conte o dinheiro** que sobrou na gaveta e escreva no campo.
4. O modal mostra o que **deveria** ter na gaveta e compara com o que você
   contou.
5. Se aparecer diferença, o texto diz se **faltou** ou **sobrou** e o valor.
6. **Confirmar fechamento**.

### Entendendo a conferência

A conferência olha só para o que passa pela gaveta:

```
troco inicial
+ vendas pagas em dinheiro
- saídas (já com o troco devolvido)
= deveria ter na gaveta
```

**Pix, débito e crédito não entram.** Esse dinheiro vai direto para a conta
da ação e nunca fica na gaveta. Se ele contasse, a conferência acusaria uma
diferença falsa sempre.

### Se a diferença não for zero

- **Faltou**: saiu mais dinheiro do que entrou. Confira se esqueceu de lançar
  uma venda em dinheiro ou se anotou uma saída a mais.
- **Sobra**: tem mais dinheiro do que o esperado. Quase sempre é uma venda em
  dinheiro não registrada.

Você pode fechar assim mesmo, com a diferença registrada. A diferença fica
salva no caixa e aparece no histórico.

---

## 5. Consultar o resumo

Na aba **Resumo** você vê três contas diferentes, e elas não são a mesma coisa:

| Conta | O que é |
|---|---|
| **Total vendido** | tudo que foi vendido, fiado incluído |
| **Recebido** | o que entrou de fato, por qualquer forma de pagamento |
| **Fiado em aberto** | o que ainda não foi pago |
| **Fica para a igreja** | o resultado líquido do turno |

O **Fica para a igreja** desconta o troco inicial, porque esse dinheiro não
foi ganho na ação.

O **fiado não entra em "Recebido"**. Ele aparece em **Total vendido** e só
entra em **Recebido** quando a conta é quitada. Isso é importante para a
conferência: o dinheiro que ainda não chegou não pode ser contado como se
estivesse na gaveta.

As listas reagem aos filtros de ação e situação no topo da aba.

---

## 6. Reabrir um caixa fechado

O caso de uso é um só: **alguém quitou o fiado depois que o caixa fechou.**

Exemplo: na hamburgada de sábado, a Ana ficou devendo R$ 40. O caixa foi
fechado. No domingo a Ana paga. Como a venda continua registrada como fiado,
é preciso reabrir o caixa para dar baixa.

1. Vá em **Histórico e Relatórios**, no menu.
2. Abra o relatório do caixa mais recente (**Ver relatório**).
3. Clique em **Reabrir este caixa**.
4. Escreva **por que está reabrindo**. É obrigatório.
5. **Reabrir caixa**.
6. Volte para a aba **Fiado em aberto** da tela do caixa e clique na venda que
   a pessoa quer pagar, em **Ver detalhes** e depois em **Marcar venda como
   paga**, escolhendo a forma do pagamento.
7. Volte para **Resumo** e feche o caixa de novo.

### As regras da reabertura

- Só o caixa **mais recente** pode ser reaberto. Reabrir um caixa antigo
  bagunçaria a contagem dos caixas seguintes.
- Precisa estar com **nenhum caixa aberto**.
- Só **administrador** e **tesouraria** reabrem.
- A **observação é obrigatória** e fica no histórico.

### O que acontece com o fechamento antigo

Ele é **substituído**. Quando você fechar de novo, os números do caixa serão
os novos. Isso é de propósito: um caixa não pode ter dois fechamentos.

Se a reabertura for um engano, basta fechar o caixa em seguida e o histórico
fica como estava.

---

## 7. Histórico e relatórios

A tela **Histórico e Relatórios** fica no menu, ao lado do caixa. Ela lista os
caixas do mais recente para o mais antigo, e cada um começa fechado: só os
quatro totais e o fiado em aberto, se houver.

Clique em **Ver relatório** para abrir o caixa completo:

- o fechamento da gaveta: valor inicial, recebido em dinheiro, saídas, o
  esperado, o que foi contado e a diferença;
- os totais por ação e por forma de pagamento;
- as saídas, com o troco devolvido;
- os devedores, com telefone ou e-mail para cobrar;
- a lista de vendas, com quem comprou e a situação de cada uma;
- as observações de reabertura e de fechamento;
- os botões de **Baixar PDF** e **Baixar CSV**.

O botão de reabrir só aparece no caixa mais recente, e só quando não há
caixa aberto.

---

## 8. Exportar

Há dois lugares para exportar, e os dois geram o mesmo papel:

- na tela do caixa, aba **Resumo**: **Excel** e **PDF** do caixa em foco;
- em **Histórico e Relatórios**, dentro do relatório de um caixa:
  **Baixar CSV** e **Baixar PDF**.

Os arquivos trazem, na mesma ordem:

1. os totais do caixa;
2. a conferência da gaveta;
3. as saídas registradas;
4. quem está devendo, com telefone e email;
5. as vendas, da mais recente para a mais antiga.

Se você aplicou filtro de ação ou situação, o PDF avisa no final quais
filtros foram usados, para o papel bater com a tela.

> O botão **Excel** gera um arquivo CSV, que o Excel abre normalmente. Se
> aparecer tudo em uma coluna só, o separador do seu Excel está com vírgula:
> importe escolhendo o ponto e vírgula como separador.

---

## Resumo em uma tela

```
ABRIR      ->  troco inicial na gaveta
REGISTRAR  ->  vendas, uma a uma, com a forma de pagamento
CONTA      ->  o fiado em aberto, uma linha por venda
SAÍDA      ->  o que saiu e o troco que voltou, editável enquanto o caixa está aberto
CONFERIR   ->  contar a gaveta e bater com o esperado
FECHAR     ->  registrar o fim do turno
REABRIR    ->  só para dar baixa em fiado pago depois
```

O que não está em nenhum desses passos não pertence ao caixa da ação. Conta
de luz, salário do pastor e dízimo ficam em outro lugar.
