import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { jsPDF } from 'jspdf';
import { SupabaseService } from '../../services/supabase.service';

interface Arrecadacao {
  id: string;
  venda_id?: string;
  categoria: 'bazar' | 'hamburgada' | 'feijoada';
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  forma_pagamento?: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado';
  status: 'pago' | 'pendente' | 'cancelado';
  data_venda: string;
  data_pagamento?: string | null;
  observacoes?: string | null;
  membro_id?: string | null;
  membro?: { id: string; nome_completo: string } | null;
}

interface GrupoPendente {
  vendaId: string;
  membro: string;
  total: number;
  itens: Arrecadacao[];
}

interface ItemRapido {
  nome: string;
  valor?: number;
}

interface ItemCarrinho {
  id: string;
  categoria: 'bazar' | 'hamburgada' | 'feijoada';
  nome: string;
  valor: number;
  quantidade: number;
}

@Component({
  selector: 'app-arrecadacoes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './arrecadacoes.component.html',
  styleUrl: './arrecadacoes.component.scss'
})
export class ArrecadacoesComponent implements OnInit {
  private readonly supabaseService = inject(SupabaseService);

  arrecadacoes: Arrecadacao[] = [];
  membros: any[] = [];
  carregando = true;
  salvando = false;
  erro = '';
  abaAtiva: 'registrar' | 'pendentes' | 'resumo' = 'registrar';

  filtroCategoria = '';
  filtroStatus = '';
  filtroBusca = '';
  carrinho: ItemCarrinho[] = [];
  modalValorLivreAberto = false;
  itemLivreDescricao = '';
  itemLivreValor: number | null = null;
  modalPagamentoAberto = false;
  vendaPagamentoId = '';
  formaPagamentoQuitacao: 'pix' | 'debito' | 'credito' | 'dinheiro' = 'dinheiro';

  novoLancamento = {
    categoria: 'bazar' as 'bazar' | 'hamburgada' | 'feijoada',
    forma_pagamento: 'dinheiro' as 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado',
    status: 'pago' as 'pago' | 'pendente',
    membro_id: '',
    data_venda: this.dataAtual(),
    observacoes: ''
  };

  ngOnInit(): void {
    this.carregarDados();
  }

  get arrecadacoesFiltradas(): Arrecadacao[] {
    const busca = this.filtroBusca.trim().toLowerCase();

    return this.arrecadacoes.filter((arrecadacao) => {
      const correspondeCategoria = !this.filtroCategoria || arrecadacao.categoria === this.filtroCategoria;
      const correspondeStatus = !this.filtroStatus || arrecadacao.status === this.filtroStatus;
      const texto = `${arrecadacao.descricao} ${arrecadacao.membro?.nome_completo ?? ''}`.toLowerCase();
      const correspondeBusca = !busca || texto.includes(busca);

      return correspondeCategoria && correspondeStatus && correspondeBusca;
    });
  }

  get totalFiltrado(): number {
    return this.arrecadacoesFiltradas
      .filter((arrecadacao) => arrecadacao.status !== 'cancelado')
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  get totalPendente(): number {
    return this.arrecadacoes
      .filter((arrecadacao) => arrecadacao.status === 'pendente')
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  get pendenciasFiltradas(): Arrecadacao[] {
    return this.arrecadacoesFiltradas.filter((arrecadacao) => arrecadacao.status === 'pendente');
  }

  get gruposPendentes(): GrupoPendente[] {
    const grupos = new Map<string, Arrecadacao[]>();

    for (const arrecadacao of this.pendenciasFiltradas) {
      const vendaId = arrecadacao.venda_id ?? arrecadacao.id;
      grupos.set(vendaId, [...(grupos.get(vendaId) ?? []), arrecadacao]);
    }

    return [...grupos.entries()]
      .map(([vendaId, itens]) => ({
        vendaId,
        membro: itens[0].membro?.nome_completo || 'Membro não identificado',
        itens,
        total: itens.reduce((total, item) => total + Number(item.valor_total), 0)
      }))
      .sort((a, b) => a.membro.localeCompare(b.membro));
  }

  get totalPago(): number {
    return this.arrecadacoes
      .filter((arrecadacao) => arrecadacao.status === 'pago')
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  get totalFeijoada(): number {
    return this.totalPorCategoria('feijoada');
  }

  get totalCarrinho(): number {
    return this.carrinho.reduce((total, item) => total + item.valor * item.quantidade, 0);
  }

  get quantidadeCarrinho(): number {
    return this.carrinho.reduce((total, item) => total + item.quantidade, 0);
  }

  setAba(aba: 'registrar' | 'pendentes' | 'resumo'): void {
    this.abaAtiva = aba;
  }

  totalPorCategoria(categoria: 'bazar' | 'hamburgada' | 'feijoada'): number {
    return this.arrecadacoes
      .filter((arrecadacao) => arrecadacao.categoria === categoria)
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  totalPorForma(forma: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado'): number {
    return this.arrecadacoes
      .filter((arrecadacao) => (arrecadacao.forma_pagamento ?? 'dinheiro') === forma)
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  nomeCategoria(categoria: Arrecadacao['categoria']): string {
    return categoria === 'bazar' ? 'Bazar' : categoria === 'feijoada' ? 'Feijoada' : 'Hamburgada';
  }

  nomeFormaPagamento(forma?: Arrecadacao['forma_pagamento']): string {
    switch (forma) {
      case 'pix': return 'Pix';
      case 'debito': return 'Débito';
      case 'credito': return 'Crédito';
      case 'fiado': return 'Fiado';
      default: return 'Dinheiro';
    }
  }

  itensRapidos(categoria: 'bazar' | 'hamburgada' | 'feijoada'): ItemRapido[] {
    const itens: Record<string, ItemRapido[]> = {
      hamburgada: [
        { nome: 'Hambúrguer', valor: 10 },
        { nome: 'Batata', valor: 6 },
        { nome: 'Refrigerante Lata', valor: 6 },
        { nome: 'Refrigerante 1L', valor: 10 },
        { nome: 'Combo', valor: 20 }
      ],
      bazar: [
        { nome: 'Vestido', valor: 15 },
        { nome: 'Camisa Social', valor: 10 },
        { nome: 'Roupa infantil', valor: 3 },
        { nome: 'Sapato ou Salto Alto', valor: 10 },
        { nome: 'Rasteirinhas', valor: 5 },
        { nome: 'Shors', valor: 5 },
        { nome: 'Blusa', valor: 5 },
        { nome: 'Calça', valor: 10 },
        { nome: 'Item diverso' },
      ],
      feijoada: [
        { nome: 'Feijoada', valor: 20 },
        { nome: 'Porção extra', valor: 5 },
        { nome: 'Bebida', valor: 6 }
      ]
    };

    return itens[categoria];
  }

  selecionarItem(item: ItemRapido): void {
    if (!item.valor) {
      this.modalValorLivreAberto = !this.modalValorLivreAberto;
      if (this.modalValorLivreAberto) {
        this.itemLivreDescricao = '';
        this.itemLivreValor = null;
      }
      return;
    }

    const id = `${this.novoLancamento.categoria}-${item.nome}`;
    const existente = this.carrinho.find((linha) => linha.id === id);

    if (existente) {
      existente.quantidade += 1;
    } else {
      this.carrinho.push({
        id,
        categoria: this.novoLancamento.categoria,
        nome: item.nome,
        valor: item.valor,
        quantidade: 1
      });
    }
  }

  confirmarItemLivre(): void {
    const descricao = this.itemLivreDescricao.trim() || 'Item diverso';
    const valor = Number(this.itemLivreValor);

    if (valor <= 0) {
      this.erro = 'Informe um valor maior que zero para o item livre.';
      return;
    }

    this.selecionarItem({ nome: descricao, valor });
    this.fecharModalValorLivre();
  }

  fecharModalValorLivre(): void {
    this.modalValorLivreAberto = false;
    this.itemLivreDescricao = '';
    this.itemLivreValor = null;
  }

  alterarQuantidade(item: ItemCarrinho, delta: number): void {
    item.quantidade += delta;
    if (item.quantidade <= 0) {
      this.removerDoCarrinho(item);
    }
  }

  removerDoCarrinho(item: ItemCarrinho): void {
    this.carrinho = this.carrinho.filter((linha) => linha.id !== item.id);
  }

  limparCarrinho(): void {
    this.carrinho = [];
  }

  selecionarFormaPagamento(forma: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado'): void {
    this.novoLancamento.forma_pagamento = forma;
    this.novoLancamento.status = forma === 'fiado' ? 'pendente' : 'pago';
    if (forma !== 'fiado') {
      this.novoLancamento.membro_id = '';
    }
  }

  async carregarDados(): Promise<void> {
    this.carregando = true;
    this.erro = '';

    const [membrosResponse, vendasResponse] = await Promise.all([
      this.supabaseService.getMembros(),
      this.supabaseService.getVendasArrecadacao()
    ]);

    if (membrosResponse.error || vendasResponse.error) {
      this.erro = 'Não foi possível carregar os dados das arrecadações.';
      console.error(membrosResponse.error || vendasResponse.error);
    } else {
      this.membros = membrosResponse.data ?? [];
      this.arrecadacoes = this.normalizarVendas(vendasResponse.data ?? []);
    }

    this.carregando = false;
  }

  async registrarLancamento(): Promise<void> {
    this.erro = '';

    if (!this.carrinho.length) {
      this.erro = 'Adicione pelo menos um item ao carrinho.';
      return;
    }

    if (this.novoLancamento.forma_pagamento === 'fiado' && !this.novoLancamento.membro_id) {
      this.erro = 'Selecione o membro responsável pelo pagamento.';
      return;
    }

    this.salvando = true;
    const membro = this.membros.find((item) => item.id === this.novoLancamento.membro_id);
    const itens = this.carrinho.map((item) => ({
      categoria: item.categoria,
      descricao: item.nome,
      quantidade: item.quantidade,
      valor_unitario: item.valor
    }));
    const total = itens.reduce((soma, item) => soma + item.quantidade * item.valor_unitario, 0);
    const venda = {
      membro_id: this.novoLancamento.membro_id || null,
      forma_pagamento: this.novoLancamento.forma_pagamento,
      status: this.novoLancamento.forma_pagamento === 'fiado' ? 'pendente' : 'pago',
      total,
      data_venda: new Date(`${this.novoLancamento.data_venda}T12:00:00`).toISOString(),
      observacoes: this.novoLancamento.observacoes.trim() || null
    };

    const { error } = await this.supabaseService.criarVendaArrecadacao(venda, itens);
    this.salvando = false;

    if (error) {
      this.erro = 'Não foi possível registrar a venda.';
      console.error(error);
      return;
    }

    this.limparCarrinho();
    this.limparFormulario();
    await this.carregarDados();
  }

  async marcarComoPago(arrecadacao: Arrecadacao): Promise<void> {
    const vendaId = arrecadacao.venda_id ?? arrecadacao.id;
    this.abrirModalPagamento(vendaId);
  }

  async marcarVendaComoPaga(grupo: GrupoPendente): Promise<void> {
    this.abrirModalPagamento(grupo.vendaId);
  }

  abrirModalPagamento(vendaId: string): void {
    this.vendaPagamentoId = vendaId;
    this.formaPagamentoQuitacao = 'dinheiro';
    this.modalPagamentoAberto = true;
  }

  fecharModalPagamento(): void {
    this.modalPagamentoAberto = false;
    this.vendaPagamentoId = '';
  }

  async confirmarPagamento(): Promise<void> {
    if (!this.vendaPagamentoId) {
      return;
    }

    this.salvando = true;
    const { error } = await this.supabaseService.marcarVendaArrecadacaoComoPaga(
      this.vendaPagamentoId,
      this.formaPagamentoQuitacao
    );
    this.salvando = false;

    if (error) {
      this.erro = 'Não foi possível marcar a venda como paga.';
      console.error(error);
      return;
    }

    this.fecharModalPagamento();
    await this.carregarDados();
  }

  async excluirItem(arrecadacao: Arrecadacao): Promise<void> {
    if (!confirm(`Excluir apenas o item "${arrecadacao.descricao}" desta venda?`)) {
      return;
    }

    const vendaId = arrecadacao.venda_id ?? arrecadacao.id;
    const totalRestante = this.arrecadacoes
      .filter((item) => (item.venda_id ?? item.id) === vendaId && item.id !== arrecadacao.id)
      .reduce((total, item) => total + Number(item.valor_total), 0);
    const { error } = await this.supabaseService.removerItemArrecadacao(
      arrecadacao.id,
      vendaId,
      totalRestante
    );
    if (error) {
      this.erro = 'Não foi possível excluir a venda.';
      console.error(error);
      return;
    }

    await this.carregarDados();
  }

  limparFormulario(): void {
    this.novoLancamento = {
      categoria: 'bazar',
      forma_pagamento: 'dinheiro',
      status: 'pago',
      membro_id: '',
      data_venda: this.dataAtual(),
      observacoes: ''
    };
  }

  formatarMoeda(valor: number): string {
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  formatarData(data: string): string {
    return new Date(data).toLocaleDateString('pt-BR');
  }

  exportarExcel(): void {
    const cabecalho = ['Data', 'Categoria', 'Descrição', 'Quantidade', 'Valor unitário', 'Total', 'Pagamento', 'Situação', 'Membro'];
    const linhas = this.arrecadacoesFiltradas.map((item) => [
      this.formatarData(item.data_venda),
      this.nomeCategoria(item.categoria),
      item.descricao,
      item.quantidade,
      Number(item.valor_unitario).toFixed(2),
      Number(item.valor_total).toFixed(2),
      this.nomeFormaPagamento(item.forma_pagamento),
      item.status === 'pendente' ? 'Pendente' : 'Pago',
      item.membro?.nome_completo ?? 'Avulso'
    ]);
    const csv = [cabecalho, ...linhas]
      .map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    this.baixarArquivo(`resumo-arrecadacoes-${this.dataAtual()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8;');
  }

  exportarPdf(): void {
    const documento = new jsPDF();
    documento.setFontSize(16);
    documento.text('Resumo de arrecadacoes', 14, 18);
    documento.setFontSize(10);
    documento.text(`Total filtrado: ${this.formatarMoeda(this.totalFiltrado)}`, 14, 27);

    let y = 38;
    this.arrecadacoesFiltradas.forEach((item) => {
      const linha = `${this.formatarData(item.data_venda)} | ${this.nomeCategoria(item.categoria)} | ${item.descricao} x${item.quantidade} | ${this.formatarMoeda(item.valor_total)} | ${this.nomeFormaPagamento(item.forma_pagamento)}`;
      const linhas = documento.splitTextToSize(linha, 180);
      if (y > 275) {
        documento.addPage();
        y = 18;
      }
      documento.text(linhas, 14, y);
      y += 7 * linhas.length;
    });

    documento.save(`resumo-arrecadacoes-${this.dataAtual()}.pdf`);
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

  private normalizarVendas(vendas: any[]): Arrecadacao[] {
    return vendas.flatMap((venda) => (venda.itens ?? []).map((item: any) => ({
      id: item.id,
      venda_id: venda.id,
      categoria: item.categoria,
      descricao: item.descricao,
      quantidade: item.quantidade,
      valor_unitario: Number(item.valor_unitario),
      valor_total: Number(item.valor_total),
      forma_pagamento: venda.forma_pagamento,
      status: venda.status,
      data_venda: venda.data_venda,
      data_pagamento: venda.data_pagamento,
      observacoes: venda.observacoes,
      membro_id: venda.membro_id,
      membro: venda.membro
    })));
  }

  private totalDaVenda(vendaId: string): number {
    return this.arrecadacoes
      .filter((item) => (item.venda_id ?? item.id) === vendaId)
      .reduce((total, item) => total + Number(item.valor_total), 0);
  }

  ehPrimeiroItemDaVenda(arrecadacao: Arrecadacao): boolean {
    const vendaId = arrecadacao.venda_id ?? arrecadacao.id;
    return this.arrecadacoesFiltradas.find((item) => (item.venda_id ?? item.id) === vendaId)?.id === arrecadacao.id;
  }

  private novoId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
