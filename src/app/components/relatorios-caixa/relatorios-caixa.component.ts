import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartData, ChartOptions } from 'chart.js';
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

interface CaixaDia {
  id: string;
  aberto_em: string;
  fechado_em?: string | null;
  total: number;
  totalFiado: number;
  totais: Record<'bazar' | 'hamburgada' | 'feijoada', number>;
}

const NOMES_CATEGORIA: Record<string, string> = { bazar: 'Bazar', hamburgada: 'Hamburgada', feijoada: 'Feijoada' };
const CORES_CATEGORIA: Record<string, string> = { bazar: '#6a1b9a', hamburgada: '#f8c20a', feijoada: '#16cdc7' };
const CORES_FORMA: Record<string, string> = { pix: '#16cdc7', debito: '#0a71f8', credito: '#f8c20a', dinheiro: '#2ca87b', fiado: '#a8651d' };
const PALETA_CAIXAS = ['#6a1b9a', '#16cdc7', '#f8c20a', '#0a71f8', '#f80abd', '#a8651d', '#2ca87b', '#d84315', '#5c6bc0', '#00897b'];

@Component({
  selector: 'app-relatorios-caixa',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective],
  templateUrl: './relatorios-caixa.component.html',
  styleUrl: './relatorios-caixa.component.scss'
})
export class RelatoriosCaixaComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private caixasTodas: any[] = [];
  private vendasTodas: any[] = [];

  carregando = true;
  erro = '';

  caixasDisponiveis: any[] = [];
  caixaSelecionadaId = '';
  linha: LinhaCaixa | null = null;
  totalArrecadado = 0;
  totalFiado = 0;
  totaisCategoria: TotalLinha[] = [];
  totaisForma: TotalLinha[] = [];

  diaCaixa = new Date().toISOString().slice(0, 10);
  carregandoCaixasDia = false;
  caixasDia: CaixaDia[] = [];
  totalDia = 0;
  fiadoDia = 0;
  vendasCategoriaData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  vendasFormaData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  vendasCaixaData: ChartData<'bar'> = { labels: [], datasets: [] };
  doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: 'currentColor', usePointStyle: true, pointStyle: 'circle' } },
      tooltip: { callbacks: { label: (contexto) => `${contexto.label}: ${this.formatarMoeda(contexto.parsed)}` } }
    }
  };
  barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (contexto) => `${contexto.dataset.label ?? ''}: ${this.formatarMoeda(contexto.parsed.y)}` } }
    },
    scales: {
      x: { ticks: { color: 'currentColor' }, grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: { color: 'currentColor', callback: (valor) => this.formatarMoeda(Number(valor)) },
        grid: { color: 'rgba(128,128,128,.15)' }
      }
    }
  };

  async ngOnInit(): Promise<void> {
    await this.carregarBase();
  }

  async carregarBase(): Promise<void> {
    this.carregando = true;
    this.erro = '';
    const [caixas, vendas] = await Promise.all([
      this.supabase.getCaixasFechadas(),
      this.supabase.getVendasArrecadacao()
    ]);

    if (caixas.error || vendas.error) {
      this.erro = 'Não foi possível carregar os dados dos relatórios.';
      console.error(caixas.error || vendas.error);
      this.carregando = false;
      return;
    }

    this.caixasTodas = caixas.data ?? [];
    this.vendasTodas = vendas.data ?? [];
    this.caixasDisponiveis = [...this.caixasTodas].sort(
      (a, b) => new Date(b.aberto_em).getTime() - new Date(a.aberto_em).getTime()
    );
    this.carregando = false;

    await this.carregarCaixasDia();
    if (this.caixaSelecionadaId) {
      this.selecionarCaixa();
    }
  }

  async carregarCaixasDia(): Promise<void> {
    if (!this.diaCaixa) return;
    this.carregandoCaixasDia = true;
    const inicio = `${this.diaCaixa}T00:00:00`;
    const fim = `${this.diaCaixa}T23:59:59.999`;
    const { data, error } = await this.supabase.getCaixas({ inicio, fim });
    if (error) {
      console.error(error);
      this.carregandoCaixasDia = false;
      return;
    }

    this.caixasDia = (data ?? []).map((caixa: any) => this.montarCaixaDia(caixa, this.vendasTodas));
    this.totalDia = this.caixasDia.reduce((soma, caixa) => soma + caixa.total, 0);
    this.fiadoDia = this.caixasDia.reduce((soma, caixa) => soma + caixa.totalFiado, 0);

    this.montarGraficosDia();
    this.carregandoCaixasDia = false;
  }

  selecionarCaixa(): void {
    this.linha = null;
    this.totalArrecadado = 0;
    this.totalFiado = 0;
    this.totaisCategoria = [];
    this.totaisForma = [];

    if (!this.caixaSelecionadaId) {
      this.montarGraficosDia();
      return;
    }

    const caixa = this.caixasTodas.find((item: any) => item.id === this.caixaSelecionadaId);
    if (!caixa) return;

    const vendasCaixa = this.vendasTodas.filter((venda: any) => venda.caixa_id === caixa.id);
    const pagas = vendasCaixa.filter((venda: any) => venda.status === 'pago');
    const pendentes = vendasCaixa.filter((venda: any) => venda.status === 'pendente');

    this.linha = {
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

    this.totalArrecadado = this.linha.totalVendas;
    this.totalFiado = this.linha.totalFiado;

    const categoria = new Map<string, number>();
    pagas.forEach((venda: any) =>
      (venda.itens ?? []).forEach((item: any) =>
        categoria.set(item.categoria, (categoria.get(item.categoria) ?? 0) + Number(item.valor_total ?? 0))
      )
    );
    this.totaisCategoria = [...categoria.entries()].map(([nome, total]) => ({ nome: this.nomeCategoria(nome), total }));

    const forma = new Map<string, number>();
    pagas.forEach((venda: any) =>
      forma.set(venda.forma_pagamento, (forma.get(venda.forma_pagamento) ?? 0) + Number(venda.total ?? 0))
    );
    this.totaisForma = [...forma.entries()].map(([nome, total]) => ({ nome: this.nomeForma(nome), total }));

    this.montarGraficosDia();
  }

  selecionarCaixaPorId(id: string): void {
    if (this.caixaSelecionadaId === id) {
      this.caixaSelecionadaId = '';
    } else {
      this.caixaSelecionadaId = id;
    }
    this.selecionarCaixa();
  }

  private montarCaixaDia(caixa: any, vendas: any[]): CaixaDia {
    const pagasCaixa = vendas.filter((venda: any) => venda.caixa_id === caixa.id && venda.status === 'pago');
    const pendentesCaixa = vendas.filter((venda: any) => venda.caixa_id === caixa.id && venda.status === 'pendente');
    const totais = { bazar: 0, hamburgada: 0, feijoada: 0 };
    pagasCaixa.forEach((venda: any) =>
      (venda.itens ?? []).forEach((item: any) => {
        if (item.categoria in totais) totais[item.categoria as keyof typeof totais] += Number(item.valor_total ?? 0);
      })
    );
    return {
      id: caixa.id,
      aberto_em: caixa.aberto_em,
      fechado_em: caixa.fechado_em,
      totais,
      total: pagasCaixa.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0),
      totalFiado: pendentesCaixa.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0)
    };
  }

  private montarGraficosDia(): void {
    const filtroId = this.caixaSelecionadaId;
    const idsDia = new Set<string>(this.caixasDia.map((caixa: CaixaDia) => caixa.id));
    const pagas = this.vendasTodas.filter(
      (venda: any) => venda.status === 'pago' && (filtroId ? venda.caixa_id === filtroId : idsDia.has(venda.caixa_id))
    );

    const categorias = ['bazar', 'hamburgada', 'feijoada'] as const;
    const porCategoria = { bazar: 0, hamburgada: 0, feijoada: 0 };
    const porForma = new Map<string, number>();
    pagas.forEach((venda: any) => {
      (venda.itens ?? []).forEach((item: any) => {
        if (item.categoria in porCategoria) porCategoria[item.categoria as keyof typeof porCategoria] += Number(item.valor_total ?? 0);
      });
      const forma = venda.forma_pagamento ?? 'dinheiro';
      porForma.set(forma, (porForma.get(forma) ?? 0) + Number(venda.total ?? 0));
    });

    this.vendasCategoriaData = {
      labels: categorias.map((c) => NOMES_CATEGORIA[c]),
      datasets: [{
        data: categorias.map((c) => porCategoria[c]),
        backgroundColor: categorias.map((c) => CORES_CATEGORIA[c]),
        borderColor: 'transparent'
      }]
    };

    this.vendasFormaData = {
      labels: [...porForma.keys()],
      datasets: [{
        data: [...porForma.values()],
        backgroundColor: [...porForma.keys()].map((forma) => CORES_FORMA[forma] ?? '#9e9e9e'),
        borderColor: 'transparent'
      }]
    };

    let caixasGrafico: CaixaDia[] = this.caixasDia;
    if (filtroId) {
      const achado = this.caixasDia.find((caixa: CaixaDia) => caixa.id === filtroId);
      if (achado) {
        caixasGrafico = [achado];
      } else {
        const caixa = this.caixasTodas.find((item: any) => item.id === filtroId);
        if (caixa) caixasGrafico = [this.montarCaixaDia(caixa, this.vendasTodas)];
      }
    }

    const comData = caixasGrafico.length === 1;
    this.vendasCaixaData = {
      labels: caixasGrafico.map((caixa: CaixaDia, indice: number) =>
        comData ? this.formatarData(caixa.aberto_em) : `Caixa ${indice + 1}`
      ),
      datasets: [{
        label: 'Total vendido',
        data: caixasGrafico.map((caixa: CaixaDia) => caixa.total),
        backgroundColor: caixasGrafico.map((caixa: CaixaDia, indice: number) =>
          comData ? (filtroId ? CORES_CATEGORIA['bazar'] : PALETA_CAIXAS[0]) : PALETA_CAIXAS[indice % PALETA_CAIXAS.length]
        ),
        borderRadius: 6
      }]
    };
  }

  rotuloCaixa(caixa: any): string {
    const data = this.formatarData(caixa.aberto_em);
    const mesmosDia = this.caixasDisponiveis.filter((item: any) => this.formatarData(item.aberto_em) === data);
    if (mesmosDia.length > 1) {
      return `${data} · ${this.formatarHora(caixa.aberto_em)}`;
    }
    return data;
  }

  rotuloCaixaSelecionada(): string {
    if (!this.linha) return '';
    const caixa = this.caixasDisponiveis.find((item: any) => item.id === this.linha?.id);
    return caixa ? this.rotuloCaixa(caixa) : this.formatarData(this.linha.abertoEm);
  }

  formatarData(data: string): string {
    return new Date(data).toLocaleDateString('pt-BR');
  }

  formatarHora(data: string): string {
    return new Date(data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
    if (!this.linha) return;

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
    const linhas = [[
      1,
      this.formatarDataHora(this.linha.abertoEm),
      this.formatarDataHora(this.linha.fechadoEm),
      Number(this.linha.valorAbertura).toFixed(2).replace('.', ','),
      Number(this.linha.totalVendas).toFixed(2).replace('.', ','),
      Number(this.linha.totalFiado).toFixed(2).replace('.', ','),
      Number(this.linha.valorEsperado).toFixed(2).replace('.', ','),
      Number(this.linha.valorFechamentoInformado).toFixed(2).replace('.', ','),
      Number(this.linha.diferenca).toFixed(2).replace('.', ',')
    ]];
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
    this.baixarArquivo(`relatorio-caixa-${this.dataAtual()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8;');
  }

  exportarPdf(): void {
    if (!this.linha) return;

    const documento = new jsPDF();
    documento.setFontSize(16);
    documento.text('Relatório de caixa', 14, 18);
    documento.setFontSize(10);
    documento.text(`Abertura: ${this.formatarDataHora(this.linha.abertoEm)}`, 14, 25);
    documento.text(`Fechamento: ${this.formatarDataHora(this.linha.fechadoEm)}`, 14, 31);
    documento.text(`Total arrecadado: ${this.formatarMoeda(this.totalArrecadado)}`, 14, 37);
    documento.text(`Fiado em aberto: ${this.formatarMoeda(this.totalFiado)}`, 14, 42);

    let y = 50;
    documento.text(`1. ${this.formatarDataHora(this.linha.abertoEm)} até ${this.formatarDataHora(this.linha.fechadoEm)}`, 14, y);
    y += 5;
    documento.text(`   Vendas: ${this.formatarMoeda(this.linha.totalVendas)}  Fiado: ${this.formatarMoeda(this.linha.totalFiado)}  Esperado: ${this.formatarMoeda(this.linha.valorEsperado)}  Diferença: ${this.formatarMoeda(this.linha.diferenca)}`, 14, y);
    y += 8;

    documento.save(`relatorio-caixa-${this.dataAtual()}.pdf`);
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