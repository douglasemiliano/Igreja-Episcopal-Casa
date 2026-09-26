import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';

/** Uma linha de venda, já resolvida para texto. */
export interface LinhaVendaRelatorio {
  descricao: string;
  dataVenda: string;
  categoria: string;
  quantidade: number;
  valorTotal: number;
  formaPagamento: string;
  situacao: string;
}

export interface LinhaSaidaRelatorio {
  data: string;
  motivo: string;
  valor: number;
  troco: number;
  valorEfetivo: number;
}

export interface LinhaDevedorRelatorio {
  nome: string;
  email: string;
  telefone: string;
  total: number;
  dataVenda: string;
  itens: string;
}

/**
 * Tudo que o relatório precisa, já calculado.
 *
 * A tela do caixa e a tela de histórico montam essa estrutura e chamam o
 * mesmo gerador. É o que garante que o PDF impresso e o papel com o número
 * da tela contem a mesma conta, mesmo quando os cálculos vivem em componentes
 * diferentes.
 */
export interface DadosRelatorioCaixa {
  titulo: string;
  subtitulo: string;
  dataEmissao: string;

  totalVendido: number;
  totalRecebido: number;
  totalPendente: number;
  totalSaidas: number;
  valorInicial: number;
  fechadoParaIgreja: number;

  totalRecebidoDinheiro: number;
  valorEsperadoEmCaixa: number;
  valorContado: number | null;
  diferenca: number | null;

  porFormaPagamento: { nome: string; quantidade: number; total: number }[];
  porCategoria: { nome: string; total: number }[];
  saidas: LinhaSaidaRelatorio[];
  devedores: LinhaDevedorRelatorio[];
  vendas: LinhaVendaRelatorio[];

  /** Filtros da tela, para o papel não divergir do que a pessoa viu. */
  filtros: string[];
}

@Injectable({ providedIn: 'root' })
export class RelatorioCaixaService {
  private readonly margem = 14;
  private readonly larguraUtil = 182;
  private readonly limitePagina = 275;

  formatarMoeda(valor: number): string {
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /**
   * Monta o PDF com quebra de página.
   *
   * O cursor `y` e os auxiliares vivem no objeto do jsPDF entre as seções, o
   * que deixa cada seção parecendo uma lista de linhas em vez de repetir a
   * lógica de paginação em cada parte do documento.
   */
  gerarPdf(dados: DadosRelatorioCaixa): jsPDF {
    const documento = new jsPDF();
    const ctx = this.criarContexto(documento);

    documento.setFontSize(16);
    documento.setFont('helvetica', 'bold');
    documento.text(dados.titulo, this.margem, 18);
    ctx.y = 26;

    if (dados.subtitulo) {
      documento.setFontSize(10);
      documento.setFont('helvetica', 'normal');
      documento.text(dados.subtitulo, this.margem, ctx.y);
      ctx.y += 6;
    }

    ctx.secao('O caixa');
    ctx.linha('Total vendido', dados.totalVendido);
    ctx.linha('Recebido de vendas', dados.totalRecebido);
    ctx.linha('Fiado em aberto', dados.totalPendente);
    ctx.linha('Saídas do caixa', -dados.totalSaidas);
    if (dados.valorInicial > 0) {
      ctx.linha('Troco inicial na gaveta', -dados.valorInicial);
    }
    ctx.linha('Fica para a igreja', dados.fechadoParaIgreja, true);

    ctx.secao('Conferência da gaveta');
    ctx.linha('Troco inicial', dados.valorInicial);
    ctx.linha('Vendas pagas em dinheiro', dados.totalRecebidoDinheiro);
    ctx.linha('Saídas (já com o troco de volta)', -dados.totalSaidas);
    ctx.linha('Deveria ter na gaveta', dados.valorEsperadoEmCaixa, true);

    if (dados.valorContado !== null) {
      ctx.linha('Contado na gaveta', dados.valorContado);
      ctx.linha('Diferença', this.textoDiferenca(dados.diferenca), true);
    }

    ctx.paragrafo(
      'Pix, débito e crédito não entram na conferência da gaveta: viram direto na conta da ação.'
    );

    const formas = dados.porFormaPagamento.filter((forma) => forma.total > 0);
    if (formas.length) {
      ctx.secao('Por forma de pagamento');
      formas.forEach((forma) =>
        ctx.linha(`${forma.nome} (${forma.quantidade}x)`, forma.total)
      );
    }

    const categorias = dados.porCategoria.filter((categoria) => categoria.total > 0);
    if (categorias.length) {
      ctx.secao('Por ação');
      categorias.forEach((categoria) => ctx.linha(categoria.nome, categoria.total));
    }

    if (dados.saidas.length) {
      ctx.secao('Saídas do caixa');
      dados.saidas.forEach((saida) => {
        ctx.detalhe(
          saida.motivo,
          `- ${this.formatarMoeda(saida.valorEfetivo)}`,
          saida.troco > 0
            ? `${saida.data} · tirou ${this.formatarMoeda(saida.valor)}, voltou ${this.formatarMoeda(saida.troco)} de troco`
            : saida.data
        );
      });
    }

    if (dados.devedores.length) {
      ctx.secao('Quem está devendo');
      dados.devedores.forEach((devedor) => {
        const contato = [devedor.telefone, devedor.email].filter(Boolean).join(' · ');
        ctx.detalhe(
          devedor.nome,
          this.formatarMoeda(devedor.total),
          `${contato || 'sem contato cadastrado'} · ${devedor.dataVenda} · ${devedor.itens}`
        );
      });
    }

    if (dados.vendas.length) {
      ctx.secao('Vendas');
      dados.vendas.forEach((venda) =>
        ctx.detalhe(
          venda.descricao,
          this.formatarMoeda(venda.valorTotal),
          `${venda.dataVenda} · ${venda.categoria} · x${venda.quantidade} · ${venda.formaPagamento} · ${venda.situacao}`
        )
      );
    }

    if (dados.filtros.length) {
      ctx.paragrafo(`Filtros aplicados nesta lista: ${dados.filtros.join('; ')}.`);
    }

    documento.setFontSize(8);
    documento.setTextColor(130);
    documento.text(`Emitido em ${dados.dataEmissao}`, this.margem, 288);

    return documento;
  }

  /**
   * CSV em blocos: totais, saídas, devedores e vendas.
   *
   * Quem abre no Excel vê a conta do caixa primeiro, que é a parte que
   * precisa bater com o papel.
   */
  gerarCsv(dados: DadosRelatorioCaixa): string {
    const linhas: string[][] = [];
    const moeda = (valor: number): string => valor.toFixed(2);

    linhas.push([dados.titulo]);
    if (dados.subtitulo) linhas.push([dados.subtitulo]);
    linhas.push(['Emitido em', dados.dataEmissao]);
    linhas.push([]);

    linhas.push(['RESUMO']);
    linhas.push(['Total vendido', moeda(dados.totalVendido)]);
    linhas.push(['Recebido de vendas', moeda(dados.totalRecebido)]);
    linhas.push(['Fiado em aberto', moeda(dados.totalPendente)]);
    linhas.push(['Saídas do caixa', moeda(dados.totalSaidas)]);
    linhas.push(['Troco inicial na gaveta', moeda(dados.valorInicial)]);
    linhas.push(['Fica para a igreja', moeda(dados.fechadoParaIgreja)]);
    linhas.push([]);

    linhas.push(['CONFERÊNCIA DA GAVETA']);
    linhas.push(['Vendas pagas em dinheiro', moeda(dados.totalRecebidoDinheiro)]);
    linhas.push(['Saídas (já com o troco de volta)', moeda(dados.totalSaidas)]);
    linhas.push(['Deveria ter na gaveta', moeda(dados.valorEsperadoEmCaixa)]);
    if (dados.valorContado !== null) {
      linhas.push(['Contado na gaveta', moeda(dados.valorContado as number)]);
      linhas.push(['Diferença', moeda(dados.diferenca ?? 0)]);
    }
    linhas.push([]);

    if (dados.saidas.length) {
      linhas.push(['SAÍDAS DO CAIXA']);
      linhas.push(['Data', 'Motivo', 'Retirado', 'Troco devolvido', 'Valor efetivo']);
      dados.saidas.forEach((saida) =>
        linhas.push([
          saida.data,
          saida.motivo,
          moeda(saida.valor),
          moeda(saida.troco),
          moeda(saida.valorEfetivo)
        ])
      );
      linhas.push([]);
    }

    if (dados.devedores.length) {
      linhas.push(['QUEM ESTÁ DEVEDO']);
      linhas.push(['Nome', 'Telefone', 'E-mail', 'Data da venda', 'Itens', 'Total']);
      dados.devedores.forEach((devedor) =>
        linhas.push([
          devedor.nome,
          devedor.telefone,
          devedor.email,
          devedor.dataVenda,
          devedor.itens,
          moeda(devedor.total)
        ])
      );
      linhas.push([]);
    }

    linhas.push(['VENDAS']);
    linhas.push([
      'Data',
      'Ação',
      'Descrição',
      'Quantidade',
      'Total',
      'Pagamento',
      'Situação',
      'Membro'
    ]);
    dados.vendas.forEach((venda) =>
      linhas.push([
        venda.dataVenda,
        venda.categoria,
        venda.descricao,
        String(venda.quantidade),
        moeda(venda.valorTotal),
        venda.formaPagamento,
        venda.situacao,
        (venda as LinhaVendaRelatorio & { membro?: string }).membro ?? 'Avulso'
      ])
    );

    if (dados.filtros.length) {
      linhas.push([]);
      linhas.push([`Filtros: ${dados.filtros.join('; ')}`]);
    }

    return linhas
      .map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
  }

  baixaArquivo(nome: string, conteudo: BlobPart, tipo: string): void {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.click();
    URL.revokeObjectURL(url);
  }

  private textoDiferenca(diferenca: number | null): string {
    if (diferenca === null) return 'Conta não conferida';
    if (diferenca === 0) return 'Conta batida';
    if (diferenca < 0) return `Faltaram ${this.formatarMoeda(Math.abs(diferenca))}`;
    return `Sobrou ${this.formatarMoeda(diferenca)}`;
  }

  /**
   * Auxiliares de escrita do PDF, com o cursor compartilhado entre as seções.
   */
  private criarContexto(documento: jsPDF) {
    const margem = this.margem;
    const larguraUtil = this.larguraUtil;
    const limite = this.limitePagina;

    // Dentro dos métodos do objeto abaixo, `this` é o próprio contexto, não o
    // serviço. Preso aqui fora para o formatador continuar acessível.
    const moeda = (valor: number): string => this.formatarMoeda(valor);

    const espaco = (altura: number): void => {
      if (ctx.y + altura > limite) {
        documento.addPage();
        ctx.y = 18;
      }
    };

    const ctx = {
      y: 0,

      secao(titulo: string): void {
        espaco(20);
        ctx.y += 6;
        documento.setFontSize(12);
        documento.setFont('helvetica', 'bold');
        documento.text(titulo, margem, ctx.y);
        ctx.y += 3;
        // a linha divisória dá cara de seção sem precisar de caixa
        documento.setDrawColor(200);
        documento.setLineWidth(0.3);
        documento.line(margem, ctx.y, margem + larguraUtil, ctx.y);
        ctx.y += 8;
      },

      linha(rotulo: string, valor: number | string, negrito = false): void {
        espaco(8);
        const texto = typeof valor === 'number' ? moeda(valor) : valor;
        documento.setFontSize(10);
        documento.setFont('helvetica', negrito ? 'bold' : 'normal');
        documento.text(rotulo, margem, ctx.y);
        documento.text(texto, margem + larguraUtil, ctx.y, { align: 'right' });
        ctx.y += 6;
      },

      /** Duas linhas: o título com o valor à direita, o detalhe embaixo em cinza. */
      detalhe(titulo: string, valor: string, subtitulo: string): void {
        espaco(16);
        documento.setFontSize(10);
        documento.setFont('helvetica', 'bold');
        documento.text(valor, margem + larguraUtil, ctx.y, { align: 'right' });
        documento.setFont('helvetica', 'normal');
        documento.text(titulo, margem, ctx.y);
        ctx.y += 5;
        documento.setFontSize(8);
        documento.setTextColor(110);
        documento.text(subtitulo, margem, ctx.y);
        documento.setTextColor(0);
        ctx.y += 9;
      },

      paragrafo(texto: string): void {
        documento.setFontSize(9);
        documento.setFont('helvetica', 'normal');
        for (const parte of documento.splitTextToSize(texto, larguraUtil)) {
          espaco(6);
          documento.text(parte, margem, ctx.y);
          ctx.y += 5;
        }
      }
    };

    return ctx;
  }
}
