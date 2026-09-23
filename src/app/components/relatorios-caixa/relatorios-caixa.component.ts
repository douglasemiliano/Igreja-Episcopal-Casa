import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { jsPDF } from 'jspdf';
import { SupabaseService } from '../../services/supabase.service';

interface LinhaCaixa {
  id: string;
  abertoEm: string;
  fechadoEm: string;
  valorAbertura: number;
  totalVendas: number;
  totalFiado: number;
  valorEsperado: number;
  valorFechamentoInformado: number;
  diferenca: number;
}

interface TotalLinha {
  nome: string;
  total: number;
}

@Component({
  selector: 'app-relatorios-caixa',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './relatorios-caixa.component.html',
  styleUrl: './relatorios-caixa.component.scss'
})
export class RelatoriosCaixaComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private todasCaixas: any[] = [];
  private todasVendas: any[] = [];

  eventos: any[] = [];
  eventoSelecionadoId = '';
  eventoSelecionado: any = null;
  carregando = true;
  erro = '';

  linhas: LinhaCaixa[] = [];
  totalArrecadado = 0;
  totalFiado = 0;
  totaisCategoria: TotalLinha[] = [];
  totaisForma: TotalLinha[] = [];

  async ngOnInit(): Promise<void> {
    await this.carregarBase();
  }

  async carregarBase(): Promise<void> {
    this.carregando = true;
    this.erro = '';
    const [agenda, caixas, vendas] = await Promise.all([
      this.supabase.getAgenda(),
      this.supabase.getCaixasFechadas(),
      this.supabase.getVendasArrecadacao()
    ]);

    if (agenda.error || caixas.error || vendas.error) {
      this.erro = 'Não foi possível carregar os dados dos relatórios.';
      console.error(agenda.error || caixas.error || vendas.error);
      this.carregando = false;
      return;
    }

    this.eventos = [...(agenda.data ?? [])].sort((a, b) =>
      new Date(b.inicio).getTime() - new Date(a.inicio).getTime()
    );
    this.todasCaixas = caixas.data ?? [];
    this.todasVendas = vendas.data ?? [];
    this.carregando = false;

    if (this.eventoSelecionadoId) {
      this.selecionarEvento();
    }
  }

  selecionarEvento(): void {
    this.linhas = [];
    this.totalArrecadado = 0;
    this.totalFiado = 0;
    this.totaisCategoria = [];
    this.totaisForma = [];

    if (!this.eventoSelecionadoId) {
      this.eventoSelecionado = null;
      return;
    }

    this.eventoSelecionado = this.eventos.find((evento) => evento.id === this.eventoSelecionadoId) ?? null;
    if (!this.eventoSelecionado) return;

    const inicio = new Date(this.eventoSelecionado.inicio);
    inicio.setHours(0, 0, 0, 0);
    const inicioMs = inicio.getTime();
    const fim = this.eventoSelecionado.fim ? new Date(this.eventoSelecionado.fim) : new Date(inicio);
    fim.setHours(23, 59, 59, 999);
    const fimMs = fim.getTime();

    const caixasDoEvento = this.todasCaixas.filter((caixa: any) => {
      const t = new Date(caixa.aberto_em).getTime();
      return t >= inicioMs && t <= fimMs;
    });

    let vendasPagas: any[] = [];
    let vendasPendentes: any[] = [];

    if (caixasDoEvento.length) {
      const caixaIds = new Set<string>(caixasDoEvento.map((caixa: any) => caixa.id));
      const vendasDoEvento = this.todasVendas.filter((venda: any) => caixaIds.has(venda.caixa_id));
      vendasPagas = vendasDoEvento.filter((venda: any) => venda.status === 'pago');
      vendasPendentes = vendasDoEvento.filter((venda: any) => venda.status === 'pendente');
    }

    this.linhas = caixasDoEvento.map((caixa: any) => {
      const pagas = vendasPagas.filter((venda: any) => venda.caixa_id === caixa.id);
      const pendentes = vendasPendentes.filter((venda: any) => venda.caixa_id === caixa.id);
      return {
        id: caixa.id,
        abertoEm: caixa.aberto_em,
        fechadoEm: caixa.fechado_em ?? caixa.aberto_em,
        valorAbertura: Number(caixa.valor_abertura ?? 0),
        totalVendas: pagas.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0),
        totalFiado: pendentes.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0),
        valorEsperado: Number(caixa.valor_esperado ?? 0),
        valorFechamentoInformado: Number(caixa.valor_fechamento_informado ?? 0),
        diferenca: Number(caixa.diferenca ?? 0)
      };
    });

    this.totalArrecadado = vendasPagas.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0);
    this.totalFiado = vendasPendentes.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0);

    const categoria = new Map<string, number>();
    vendasPagas.forEach((venda: any) =>
      (venda.itens ?? []).forEach((item: any) =>
        categoria.set(item.categoria, (categoria.get(item.categoria) ?? 0) + Number(item.valor_total ?? 0))
      )
    );
    this.totaisCategoria = [...categoria.entries()].map(([nome, total]) => ({ nome: this.nomeCategoria(nome), total }));

    const forma = new Map<string, number>();
    vendasPagas.forEach((venda: any) =>
      forma.set(venda.forma_pagamento, (forma.get(venda.forma_pagamento) ?? 0) + Number(venda.total ?? 0))
    );
    this.totaisForma = [...forma.entries()].map(([nome, total]) => ({ nome: this.nomeForma(nome), total }));
  }

  nomeCategoria(categoria: string): string {
    return categoria === 'bazar' ? 'Bazar' : categoria === 'feijoada' ? 'Feijoada' : 'Hamburgada';
  }

  nomeForma(forma: string): string {
    switch (forma) {
      case 'pix': return 'Pix';
      case 'debito': return 'Débito';
      case 'credito': return 'Crédito';
      case 'fiado': return 'Fiado';
      default: return 'Dinheiro';
    }
  }

  formatarMoeda(valor: number): string {
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  formatarDataHora(data: string): string {
    return new Date(data).toLocaleString('pt-BR');
  }

  exportarExcel(): void {
    const cabecalho = [
      'Caixa',
      'Abertura',
      'Fechamento',
      'Valor de abertura',
      'Total de vendas',
      'Fiado',
      'Valor esperado',
      'Fechamento informado',
      'Diferença'
    ];
    const linhas = this.linhas.map((linha, indice) => [
      indice + 1,
      this.formatarDataHora(linha.abertoEm),
      this.formatarDataHora(linha.fechadoEm),
      Number(linha.valorAbertura).toFixed(2).replace('.', ','),
      Number(linha.totalVendas).toFixed(2).replace('.', ','),
      Number(linha.totalFiado).toFixed(2).replace('.', ','),
      Number(linha.valorEsperado).toFixed(2).replace('.', ','),
      Number(linha.valorFechamentoInformado).toFixed(2).replace('.', ','),
      Number(linha.diferenca).toFixed(2).replace('.', ',')
    ]);
    const resumo = [
      'Total',
      '',
      '',
      '',
      this.formatarMoeda(this.totalArrecadado).replace(/[^0-9,.-]/g, ''),
      this.formatarMoeda(this.totalFiado).replace(/[^0-9,.-]/g, ''),
      '',
      '',
      ''
    ];
    const categorias = this.totaisCategoria.map((item) => ['', '', `Categoria: ${item.nome}`, '', this.formatarMoeda(item.total).replace(/[^0-9,.-]/g, ''), '', '', '', '']);
    const formas = this.totaisForma.map((item) => ['', '', `Pagamento: ${item.nome}`, '', this.formatarMoeda(item.total).replace(/[^0-9,.-]/g, ''), '', '', '', '']);

    const csv = [cabecalho, ...linhas, resumo, ...categorias, ...formas]
      .map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    this.baixarArquivo(`relatorio-caixas-${this.dataAtual()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8;');
  }

  exportarPdf(): void {
    const documento = new jsPDF();
    documento.setFontSize(16);
    documento.text('Relatório de caixas', 14, 18);
    if (this.eventoSelecionado) {
      documento.setFontSize(10);
      documento.text(`Evento: ${this.eventoSelecionado.titulo}`, 14, 25);
    }
    documento.setFontSize(10);
    documento.text(`Total arrecadado: ${this.formatarMoeda(this.totalArrecadado)}`, 14, 31);
    documento.text(`Fiado em aberto: ${this.formatarMoeda(this.totalFiado)}`, 14, 36);

    let y = 44;
    this.linhas.forEach((linha, indice) => {
      if (y > 275) {
        documento.addPage();
        y = 18;
      }
      documento.text(
        `${indice + 1}. ${this.formatarDataHora(linha.abertoEm)} até ${this.formatarDataHora(linha.fechadoEm)}`,
        14,
        y
      );
      y += 5;
      documento.text(`   Vendas: ${this.formatarMoeda(linha.totalVendas)}  Fiado: ${this.formatarMoeda(linha.totalFiado)}  Esperado: ${this.formatarMoeda(linha.valorEsperado)}  Diferença: ${this.formatarMoeda(linha.diferenca)}`, 14, y);
      y += 8;
    });

    documento.save(`relatorio-caixas-${this.dataAtual()}.pdf`);
  }

  private baixarArquivo(nome: string, conteudo: string, tipo: string): void {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.click();
    URL.revokeObjectURL(url);
  }

  private dataAtual(): string {
    return new Date().toISOString().slice(0, 10);
  }
}