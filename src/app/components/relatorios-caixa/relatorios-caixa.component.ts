import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartData, ChartOptions } from 'chart.js';
import { CoreService } from '../../services/core.service';
import { PermissaoService } from '../../services/permissao.service';
import { DadosRelatorioCaixa, RelatorioCaixaService } from '../../services/relatorio-caixa.service';
import { SupabaseService } from '../../services/supabase.service';

interface Caixa {
  id: string;
  status: string;
  aberto_em: string;
  fechado_em?: string | null;
  valor_abertura?: number | null;
  valor_esperado?: number | null;
  valor_fechamento_informado?: number | null;
  diferenca?: number | null;
  observacoes_fechamento?: string | null;
  observacoes_reabertura?: string | null;
}

/** Uma linha de venda, achatada. É a mesma base da tela do caixa. */
interface ItemVenda {
  id: string;
  venda_id: string;
  caixa_id: string;
  categoria: 'bazar' | 'hamburgada' | 'feijoada';
  descricao: string;
  quantidade: number;
  valor_total: number;
  forma_pagamento: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado';
  status: 'pago' | 'pendente' | 'cancelado';
  data_venda: string;
  membro_id?: string | null;
  membro?: { id: string; nome_completo: string; email?: string | null; telefone?: string | null } | null;
}

interface SaidaCaixa {
  id: string;
  caixa_id: string;
  valor: number;
  troco: number;
  valor_efetivo: number;
  motivo: string;
  criado_em: string;
}

interface LinhaDevedor {
  chave: string;
  nome: string;
  email: string;
  telefone: string;
  total: number;
  vendas: number;
  dataVenda: string;
  itens: string;
}

interface CaixaDia {
  id: string;
  aberto_em: string;
  fechado_em?: string | null;
  total: number;
  totalFiado: number;
  totais: Record<'bazar' | 'hamburgada' | 'feijoada', number>;
}

const CATEGORIAS = ['bazar', 'hamburgada', 'feijoada'] as const;
const FORMAS = ['pix', 'debito', 'credito', 'dinheiro', 'fiado'] as const;

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
  private readonly relatorioService = inject(RelatorioCaixaService);
  private readonly coreService = inject(CoreService);
  private readonly permissao = inject(PermissaoService);

  readonly categorias = CATEGORIAS;
  readonly formas = FORMAS;

  /** Todas as vendas achatadas em linhas de item: fonte única dos totais. */
  private itens: ItemVenda[] = [];

  carregando = true;
  carregandoCaixasDia = false;
  salvando = false;
  erro = '';

  caixas: Caixa[] = [];
  caixaAberto: Caixa | null = null;
  saidas: SaidaCaixa[] = [];

  /** Caixa aberto no momento. Trava a reabertura de qualquer outro. */
  caixaExpandido: string | null = null;
  caixaSelecionadaId = '';
  filtroCategoria = '';

  modalReabrirAberto = false;
  caixaParaReabrir: Caixa | null = null;
  observacoesReabertura = '';

  diaCaixa = new Date().toISOString().slice(0, 10);
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
    // `podeReabrir` lê o conjunto de capacidades, então ele precisa estar
    // carregado antes do primeiro desenho, senão o botão some e volta.
    await this.permissao.carregar();

    await this.carregarBase();
  }

  // ---------- carregamento ----------

  async carregarBase(): Promise<void> {
    this.carregando = true;
    this.erro = '';

    const [caixas, vendas, aberto] = await Promise.all([
      this.supabase.getTodasCaixas(),
      this.supabase.getVendasArrecadacao(),
      this.supabase.getCaixaAberto()
    ]);

    if (caixas.error || vendas.error) {
      this.erro = 'Não foi possível carregar os dados dos relatórios.';
      console.error(caixas.error || vendas.error);
      this.carregando = false;
      return;
    }

    this.caixas = [...(caixas.data ?? [])].sort(
      (a, b) => new Date(b.aberto_em).getTime() - new Date(a.aberto_em).getTime()
    );
    this.caixaAberto = aberto.data ?? null;
    this.itens = this.normalizarVendas(vendas.data ?? []);

    // Uma consulta para todas as saídas: a lista mostra o total de cada turno,
    // e ir uma query por caixa deixaria a tela lenta.
    if (this.caixas.length) {
      const { data, error } = await this.supabase.getSaidasCaixa(this.caixas.map((caixa) => caixa.id));
      if (error) {
        console.error(error);
      } else {
        this.saidas = data ?? [];
      }
    } else {
      this.saidas = [];
    }

    this.carregando = false;

    await this.carregarCaixasDia();
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

    this.caixasDia = (data ?? []).map((caixa: any) => this.montarCaixaDia(caixa));
    this.totalDia = this.caixasDia.reduce((soma, caixa) => soma + caixa.total, 0);
    this.fiadoDia = this.caixasDia.reduce((soma, caixa) => soma + caixa.totalFiado, 0);

    this.montarGraficosDia();
    this.carregandoCaixasDia = false;
  }

  // ---------- totais por caixa ----------

  private itensDo(caixaId: string): ItemVenda[] {
    const base = this.itens.filter((item) => item.caixa_id === caixaId);
    if (!this.filtroCategoria) return base;
    return base.filter((item) => item.categoria === this.filtroCategoria);
  }

  private somar(caixaId: string, filtro: (item: ItemVenda) => boolean): number {
    return this.itensDo(caixaId)
      .filter(filtro)
      .reduce((total, item) => total + Number(item.valor_total), 0);
  }

  totalVendido(caixaId: string): number {
    return this.somar(caixaId, (item) => item.status !== 'cancelado');
  }

  totalRecebido(caixaId: string): number {
    return this.somar(caixaId, (item) => item.status === 'pago');
  }

  totalPendente(caixaId: string): number {
    return this.somar(caixaId, (item) => item.status === 'pendente');
  }

  totalRecebidoDinheiro(caixaId: string): number {
    return this.somar(
      caixaId,
      (item) => item.status === 'pago' && (item.forma_pagamento ?? 'dinheiro') === 'dinheiro'
    );
  }

  totalSaidas(caixaId: string): number {
    return this.saidas
      .filter((saida) => saida.caixa_id === caixaId)
      .reduce((total, saida) => total + Number(saida.valor_efetivo), 0);
  }

  valorInicial(caixa: Caixa): number {
    return Number(caixa.valor_abertura ?? 0);
  }

  /** i + recebido em dinheiro - saídas. O mesmo do fechamento. */
  valorEsperadoEmCaixa(caixa: Caixa): number {
    return this.valorInicial(caixa) + this.totalRecebidoDinheiro(caixa.id) - this.totalSaidas(caixa.id);
  }

  /** recebido - saídas - valor inicial: o que sobra para a igreja. */
  fechadoParaIgreja(caixaId: string): number {
    const caixa = this.caixas.find((item) => item.id === caixaId);
    if (!caixa) return 0;
    return this.totalRecebido(caixaId) - this.totalSaidas(caixaId) - this.valorInicial(caixa);
  }

  vendasDoCaixa(caixaId: string): ItemVenda[] {
    return [...this.itensDo(caixaId)].sort((a, b) => {
      const porData = new Date(b.data_venda).getTime() - new Date(a.data_venda).getTime();
      return porData !== 0 ? porData : b.id.localeCompare(a.id);
    });
  }

  saidasDoCaixa(caixaId: string): SaidaCaixa[] {
    return this.saidas
      .filter((saida) => saida.caixa_id === caixaId)
      .sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());
  }

  /** Fiado agrupado por pessoa, com o contato para cobrar. */
  devedoresDoCaixa(caixaId: string): LinhaDevedor[] {
    const grupos = new Map<string, ItemVenda[]>();

    // Sem o filtro de categoria: quem está devendo precisa aparecer inteiro,
    // mesmo que a lista esteja filtrada para a hamburgada.
    for (const item of this.itens) {
      if (item.caixa_id !== caixaId || item.status !== 'pendente') continue;
      // uma pessoa, uma linha: comprar fiado duas vezes não vira duas contas
      const chave = item.membro_id ?? 'sem-membro';
      grupos.set(chave, [...(grupos.get(chave) ?? []), item]);
    }

    return [...grupos.entries()]
      .map(([chave, itens]) => ({
        chave,
        nome: itens[0].membro?.nome_completo || 'Membro não identificado',
        email: itens[0].membro?.email ?? '',
        telefone: itens[0].membro?.telefone ?? '',
        total: itens.reduce((total, item) => total + Number(item.valor_total), 0),
        vendas: new Set(itens.map((item) => item.venda_id)).size,
        dataVenda: itens.reduce(
          (maisRecente, item) => (item.data_venda > maisRecente ? item.data_venda : maisRecente),
          itens[0].data_venda
        ),
        itens: itens.map((item) => `${item.quantidade}x ${item.descricao}`).join(', ')
      }))
      .sort((a, b) => b.total - a.total);
  }

  totalPorCategoria(caixaId: string, categoria: 'bazar' | 'hamburgada' | 'feijoada'): number {
    return this.itensDo(caixaId)
      .filter((item) => item.categoria === categoria && item.status !== 'cancelado')
      .reduce((total, item) => total + Number(item.valor_total), 0);
  }

  totalPorForma(caixaId: string, forma: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado'): number {
    return this.itensDo(caixaId)
      .filter((item) => (item.forma_pagamento ?? 'dinheiro') === forma)
      .reduce((total, item) => total + Number(item.valor_total), 0);
  }

  /** Conta vendas, não itens: uma venda de três itens é uma venda. */
  quantidadePorForma(caixaId: string, forma: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado'): number {
    return new Set(
      this.itensDo(caixaId)
        .filter((item) => (item.forma_pagamento ?? 'dinheiro') === forma)
        .map((item) => item.venda_id)
    ).size;
  }

  // ---------- reabertura ----------

  /**
   * Só o caixa mais recente fechado pode reabrir, só se não há outro aberto e
   * só para quem tem o perfil. As mesmas travas existem no banco; repetir aqui
   * é para o botão não aparecer quando não vai funcionar.
   */
  /**
   * Capacidade `reabrir_caixa`. O banco cobra isso de novo, mas não vale
   * mostrar o botão para quem vai tomar erro.
   */
  podeReabrir(caixa: Caixa): boolean {
    if (!this.permissao.pode('reabrir_caixa')) return false;
    if (this.caixaAberto) return false;
    if (caixa.status !== 'fechado') return false;
    return this.caixas[0]?.id === caixa.id;
  }

  get podeReabrirAlgum(): boolean {
    return this.caixas.some((caixa) => this.podeReabrir(caixa));
  }

  abrirModalReabertura(caixa: Caixa): void {
    this.erro = '';
    this.observacoesReabertura = '';
    this.caixaParaReabrir = caixa;
    this.modalReabrirAberto = true;
  }

  fecharModalReabertura(): void {
    this.modalReabrirAberto = false;
    this.caixaParaReabrir = null;
  }

  async confirmarReabertura(): Promise<void> {
    this.erro = '';

    if (!this.caixaParaReabrir) return;

    const observacoes = this.observacoesReabertura.trim();
    if (!observacoes) {
      this.erro = 'Escreva o motivo da reabertura.';
      return;
    }

    this.salvando = true;
    const { error } = await this.supabase.reabrirCaixa(this.caixaParaReabrir.id, observacoes);
    this.salvando = false;

    if (error) {
      this.erro = error.message || 'Não foi possível reabrir o caixa.';
      console.error(error);
      return;
    }

    this.modalReabrirAberto = false;
    this.caixaParaReabrir = null;
    this.observacoesReabertura = '';
    await this.carregarBase();
  }

  // ---------- lista e exportação ----------

  alternarResumo(caixaId: string): void {
    this.erro = '';
    this.caixaExpandido = this.caixaExpandido === caixaId ? null : caixaId;
  }

  exportarPdf(caixa: Caixa): void {
    this.relatorioService
      .gerarPdf(this.dadosRelatorio(caixa))
      .save(`caixa-${this.dataCurta(caixa.aberto_em)}.pdf`);
  }

  exportarCsv(caixa: Caixa): void {
    const csv = this.relatorioService.gerarCsv(this.dadosRelatorio(caixa));
    this.relatorioService.baixaArquivo(
      `caixa-${this.dataCurta(caixa.aberto_em)}.csv`,
      `\ufeff${csv}`,
      'text/csv;charset=utf-8;'
    );
  }

  private dadosRelatorio(caixa: Caixa): DadosRelatorioCaixa {
    return {
      titulo: 'Resumo do caixa',
      subtitulo: `Caixa de ${this.formatarData(caixa.aberto_em)} · ${
        caixa.status === 'aberto' ? 'em andamento' : 'encerrado'
      }`,
      dataEmissao: this.formatarDataHora(new Date().toISOString()),

      totalVendido: this.totalVendido(caixa.id),
      totalRecebido: this.totalRecebido(caixa.id),
      totalPendente: this.totalPendente(caixa.id),
      totalSaidas: this.totalSaidas(caixa.id),
      valorInicial: this.valorInicial(caixa),
      fechadoParaIgreja: this.fechadoParaIgreja(caixa.id),

      totalRecebidoDinheiro: this.totalRecebidoDinheiro(caixa.id),
      valorEsperadoEmCaixa: this.valorEsperadoEmCaixa(caixa),
      valorContado: caixa.valor_fechamento_informado ?? null,
      diferenca: caixa.diferenca ?? null,

      porFormaPagamento: FORMAS.map((forma) => ({
        nome: this.nomeForma(forma),
        quantidade: this.quantidadePorForma(caixa.id, forma),
        total: this.totalPorForma(caixa.id, forma)
      })),
      porCategoria: CATEGORIAS.map((categoria) => ({
        nome: NOMES_CATEGORIA[categoria],
        total: this.totalPorCategoria(caixa.id, categoria)
      })),

      saidas: this.saidasDoCaixa(caixa.id).map((saida) => ({
        data: this.formatarDataHora(saida.criado_em),
        motivo: saida.motivo,
        valor: Number(saida.valor),
        troco: Number(saida.troco),
        valorEfetivo: Number(saida.valor_efetivo)
      })),

      devedores: this.devedoresDoCaixa(caixa.id).map((devedor) => ({
        nome: devedor.nome,
        email: devedor.email,
        telefone: devedor.telefone,
        total: devedor.total,
        vendas: devedor.vendas,
        dataVenda: this.formatarData(devedor.dataVenda),
        itens: devedor.itens
      })),

      vendas: this.itensDo(caixa.id).map((item) => ({
        descricao: item.descricao,
        dataVenda: this.formatarData(item.data_venda),
        categoria: NOMES_CATEGORIA[item.categoria],
        quantidade: item.quantidade,
        valorTotal: Number(item.valor_total),
        formaPagamento: this.nomeForma(item.forma_pagamento),
        situacao: item.status === 'pendente' ? 'Pendente' : item.status === 'cancelado' ? 'Cancelada' : 'Paga',
        membro: item.membro?.nome_completo ?? 'Avulso'
      })),

      filtros: this.filtroCategoria ? [`Ação: ${NOMES_CATEGORIA[this.filtroCategoria]}`] : []
    };
  }

  // ---------- gráficos do dia ----------

  private montarCaixaDia(caixa: any): CaixaDia {
    const pagas = this.itens.filter((item) => item.caixa_id === caixa.id && item.status === 'pago');
    const pendentes = this.itens.filter((item) => item.caixa_id === caixa.id && item.status === 'pendente');
    const totais = { bazar: 0, hamburgada: 0, feijoada: 0 };

    pagas.forEach((item) => {
      if (item.categoria in totais) totais[item.categoria as keyof typeof totais] += Number(item.valor_total ?? 0);
    });

    return {
      id: caixa.id,
      aberto_em: caixa.aberto_em,
      fechado_em: caixa.fechado_em,
      totais,
      total: pagas.reduce((soma, item) => soma + Number(item.valor_total ?? 0), 0),
      totalFiado: pendentes.reduce((soma, item) => soma + Number(item.valor_total ?? 0), 0)
    };
  }

  private montarGraficosDia(): void {
    const filtroId = this.caixaSelecionadaId;
    const idsDia = new Set<string>(this.caixasDia.map((caixa) => caixa.id));

    const pagas = this.itens.filter(
      (item) =>
        item.status === 'pago' && (filtroId ? item.caixa_id === filtroId : idsDia.has(item.caixa_id))
    );

    const porCategoria = { bazar: 0, hamburgada: 0, feijoada: 0 };
    const porForma = new Map<string, number>();

    pagas.forEach((item) => {
      if (item.categoria in porCategoria) porCategoria[item.categoria as keyof typeof porCategoria] += Number(item.valor_total);
      const forma = item.forma_pagamento ?? 'dinheiro';
      porForma.set(forma, (porForma.get(forma) ?? 0) + Number(item.valor_total));
    });

    this.vendasCategoriaData = {
      labels: CATEGORIAS.map((categoria) => NOMES_CATEGORIA[categoria]),
      datasets: [{
        data: CATEGORIAS.map((categoria) => porCategoria[categoria]),
        backgroundColor: CATEGORIAS.map((categoria) => CORES_CATEGORIA[categoria]),
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

    let caixasGrafico = this.caixasDia;
    if (filtroId) {
      const achado = this.caixasDia.find((caixa) => caixa.id === filtroId);
      if (achado) {
        caixasGrafico = [achado];
      } else {
        const caixa = this.caixas.find((item) => item.id === filtroId);
        if (caixa) caixasGrafico = [this.montarCaixaDia(caixa)];
      }
    }

    const comData = caixasGrafico.length === 1;
    this.vendasCaixaData = {
      labels: caixasGrafico.map((caixa, indice) =>
        comData ? this.formatarData(caixa.aberto_em) : `Caixa ${indice + 1}`
      ),
      datasets: [{
        label: 'Total vendido',
        data: caixasGrafico.map((caixa) => caixa.total),
        backgroundColor: caixasGrafico.map((caixa, indice) =>
          comData
            ? (filtroId ? CORES_CATEGORIA['bazar'] : PALETA_CAIXAS[0])
            : PALETA_CAIXAS[indice % PALETA_CAIXAS.length]
        ),
        borderRadius: 6
      }]
    };
  }

  /** Selecionar a caixa pelo gráfico continua filtrando os outros gráficos. */
  selecionarCaixa(): void {
    this.montarGraficosDia();
  }

  selecionarCaixaPorId(id: string): void {
    this.caixaSelecionadaId = this.caixaSelecionadaId === id ? '' : id;
    this.selecionarCaixa();
  }

  rotuloCaixa(caixa: Caixa): string {
    const data = this.formatarData(caixa.aberto_em);
    const mesmosDia = this.caixas.filter((item) => this.formatarData(item.aberto_em) === data);
    return mesmosDia.length > 1 ? `${data} · ${this.formatarHora(caixa.aberto_em)}` : data;
  }

  // ---------- texto ----------

  nomeCategoria(categoria: string): string {
    return NOMES_CATEGORIA[categoria] ?? categoria;
  }

  nomeForma(forma?: string): string {
    switch (forma) {
      case 'pix': return 'Pix';
      case 'debito': return 'Débito';
      case 'credito': return 'Crédito';
      case 'fiado': return 'Fiado';
      default: return 'Dinheiro';
    }
  }

  formatarData(data: string): string {
    return new Date(data).toLocaleDateString('pt-BR');
  }

  formatarHora(data: string): string {
    return new Date(data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  formatarDataHora(data: string): string {
    return new Date(data).toLocaleString('pt-BR');
  }

  formatarMoeda(valor: number): string {
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Numeric do Postgres chega como string. */
  paraNumero(valor: number | string | null | undefined): number {
    return Number(valor ?? 0);
  }

  private dataCurta(data: string): string {
    return new Date(data).toISOString().slice(0, 10);
  }

  /**
   * Achata venda+itens em uma linha por item. Todo total da tela sai daqui,
   * e é o mesmo achatamento da tela do caixa — assim os dois lados não têm
   * como mostrar números diferentes.
   */
  private normalizarVendas(vendas: any[]): ItemVenda[] {
    return vendas.flatMap((venda) =>
      (venda.itens ?? []).map((item: any) => ({
        id: item.id,
        venda_id: venda.id,
        caixa_id: venda.caixa_id,
        categoria: item.categoria,
        descricao: item.descricao,
        quantidade: item.quantidade,
        valor_total: item.valor_total,
        forma_pagamento: venda.forma_pagamento,
        status: venda.status,
        data_venda: venda.data_venda,
        membro_id: venda.membro_id ?? null,
        membro: venda.membro ?? null
      }))
    );
  }
}
