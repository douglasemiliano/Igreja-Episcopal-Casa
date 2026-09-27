import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DadosRelatorioCaixa, RelatorioCaixaService } from '../../services/relatorio-caixa.service';
import { SupabaseService } from '../../services/supabase.service';

interface Arrecadacao {
  id: string;
  venda_id?: string;
  caixa_id?: string | null;
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
  membro?: { id: string; nome_completo: string; email?: string | null; telefone?: string | null } | null;
}

/** Dinheiro que saiu do caixa durante o turno (insumos, compras). */
interface SaidaCaixa {
  id: string;
  caixa_id: string;
  valor: number;
  troco: number;
  valor_efetivo: number;
  motivo: string;
  criado_em: string;
}

/** Uma pessoa devendo, agrupada por pessoa, para a lista de quem está devendo. */
interface Devedor {
  /** A conta da pessoa, no mesmo formato de `ContaMembro.chave`. */
  chave: string;
  nome: string;
  email: string;
  telefone: string;
  total: number;
  /** Quantas vendas somam esta dívida. */
  vendas: number;
  /** A data da venda mais recente: é a que dá para cobrar. */
  dataVenda: string;
  itens: string;
}

/** Uma venda em aberto: a linha que aparece dentro da conta do membro. */
interface VendaPendente {
  vendaId: string;
  membro_id: string | null;
  caixa_id: string | null;
  membro: string;
  telefone: string;
  email: string;
  forma_pagamento: NonNullable<Arrecadacao['forma_pagamento']>;
  data_venda: string;
  itens: Arrecadacao[];
  total: number;
  fiadoEmOutrosCaixas: number;
}

/**
 * A conta de fiado de uma pessoa, dentro de um caixa.
 *
 * A chave é membro + caixa, de propósito. Se a pessoa comprou no sábado e
 * voltou no domingo, são duas contas — misturar faria a conferência da gaveta
 * de um caixa depender de dinheiro de outro.
 */
interface ContaMembro {
  chave: string;
  membro: string;
  telefone: string;
  email: string;
  /** As vendas que somam esta conta, da mais antiga para a mais recente. */
  vendas: VendaPendente[];
  vendaIds: string[];
  total: number;
  /** Fiado da mesma pessoa em outros caixas, só para aviso. */
  fiadoEmOutrosCaixas: number;
}

interface VendaAgrupada {
  vendaId: string;
  /** Quem vai pagar. Vazio quando a venda não tem membro vinculado. */
  membro: string;
  /** Uma venda pode misturar ações: bazar e hamburgada no mesmo carrinho. */
  categorias: Arrecadacao['categoria'][];
  forma_pagamento: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado';
  status: 'pago' | 'pendente';
  data_venda: string;
  observacoes?: string | null;
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


interface Caixa {
  id: string;
  status: 'aberto' | 'fechado';
  aberto_por: string;
  aberto_em: string;
  valor_abertura: number;
  observacoes_abertura?: string | null;
  fechado_por?: string | null;
  fechado_em?: string | null;
  valor_fechamento_informado?: number | null;
  valor_esperado?: number | null;
  diferenca?: number | null;
  observacoes_fechamento?: string | null;
  reaberto_em?: string | null;
  observacoes_reabertura?: string | null;
  vezes_reaberto?: number;
}

@Component({
  selector: 'app-arrecadacoes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './arrecadacoes.component.html',
  styleUrl: './arrecadacoes.component.scss'
})
export class ArrecadacoesComponent implements OnInit, OnDestroy {
  private readonly supabaseService = inject(SupabaseService);
  private readonly relatorioService = inject(RelatorioCaixaService);

  readonly formasPagamento: NonNullable<Arrecadacao['forma_pagamento']>[] = ['pix', 'debito', 'credito', 'dinheiro', 'fiado'];

  arrecadacoes: Arrecadacao[] = [];
  membros: any[] = [];
  carregando = true;
  salvando = false;
  erro = '';
  abaAtiva: 'registrar' | 'pendentes' | 'resumo' = 'registrar';

  filtroCategoria: Arrecadacao['categoria'] | '' = '';
  filtroStatus = '';
  filtroBusca = '';
  carrinho: ItemCarrinho[] = [];
  carrinhoAberto = false;
  etapaCarrinho: 'itens' | 'pagamento' = 'itens';
  pagamentoConfirmado = false;
  toastVendaRegistrada = false;
  vendasExpandidas = new Set<string>();
  contasExpandidas = new Set<string>();
  private toastTimer?: ReturnType<typeof setTimeout>;
  modalValorLivreAberto = false;
  itemLivreDescricao = '';
  itemLivreValor: number | null = null;
  modalPagamentoAberto = false;
  /**
   * A conta que o modal vai quitar. Guardar as vendas aqui, e não só a chave,
   * porque o modal precisa mostrar o total e porque a lista pode mudar entre a
   * hora de abrir e a de confirmar.
   */
  contaPagamento: { nome: string; total: number; vendaIds: string[] } | null = null;
  formaPagamentoQuitacao: 'pix' | 'debito' | 'credito' | 'dinheiro' = 'dinheiro';

  novoLancamento = {
    categoria: 'bazar' as 'bazar' | 'hamburgada' | 'feijoada',
    forma_pagamento: 'dinheiro' as 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado',
    status: 'pago' as 'pago' | 'pendente',
    membro_id: '',
    data_venda: this.dataAtual(),
    observacoes: ''
  };

  caixaAtual: Caixa | null = null;

  /** Todos os caixas, do mais recente para o mais antigo. Alimenta o histórico. */
  historicoCaixas: Caixa[] = [];
  saidas: SaidaCaixa[] = [];

modalAberturaCaixaAberto = false;
observacoesAberturaCaixa = '';
/** Troco que a pessoa põe na gaveta ao abrir. Não é receita da ação. */
valorAberturaCaixa: number | null = null;

modalFechamentoCaixaAberto = false;
observacoesFechamentoCaixa = '';
/** Quanto a pessoa contou na gaveta. Vazio = não contou, e não há diferença. */
valorFechamentoInformado: number | null = null;

  modalSaidaAberto = false;
  /** Saída sendo corrigida. Nulo quando é um lançamento novo. */
  saidaEmEdicao: SaidaCaixa | null = null;
  novaSaida = { valor: null as number | null, troco: 0 as number | null, motivo: '' };

  ngOnInit(): void {
    this.carregarDados();
    this.carregarCaixa();
  }

  ngOnDestroy(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }

  async carregarCaixa(): Promise<void> {
  const { data, error } = await this.supabaseService.getCaixaAberto();
  if (error) {
    console.error(error);
    return;
  }
  this.caixaAtual = data ?? null;
}

get totalArrecadadoCaixaAtual(): number {
  if (!this.caixaAtual) return 0;
  const vendaIds = new Set(
    this.arrecadacoes
      .filter((item) => item.caixa_id === this.caixaAtual!.id && item.status === 'pago')
      .map((item) => item.venda_id ?? item.id)
  );
  return this.arrecadacoes
    .filter((item) => vendaIds.has(item.venda_id ?? item.id) && item.status === 'pago')
    .reduce((total, item) => total + Number(item.valor_total), 0);
}

  /**
   * O caixa que a tela está olhando: o aberto, ou o mais recente se já fechou.
   * Sem isso, o fiado de ontem fica invisível até alguém abrir o caixa de hoje.
   */
  get caixaEmFoco(): Caixa | null {
    return this.caixaAtual ?? this.historicoCaixas[0] ?? null;
  }

  get arrecadacoesCaixa(): Arrecadacao[] {
    const caixa = this.caixaEmFoco;
    if (!caixa) return [];

    return this.arrecadacoes
      .filter((item) => item.caixa_id === caixa.id)
      .sort((a, b) => {
        const porData = new Date(b.data_venda).getTime() - new Date(a.data_venda).getTime();
        if (porData !== 0) return porData;
        // mesmo timestamp: desempata pelo id, que é sequencial, para a ordem
        // não depender de como o Postgres devolveu as linhas
        return b.id.localeCompare(a.id);
      });
  }

  get saidasDoCaixa(): SaidaCaixa[] {
    const caixa = this.caixaEmFoco;
    if (!caixa) return [];
    return this.saidas.filter((saida) => saida.caixa_id === caixa.id);
  }

  get arrecadacoesFiltradas(): Arrecadacao[] {
    const busca = this.filtroBusca.trim().toLowerCase();

    return this.arrecadacoesCaixa.filter((arrecadacao) => {
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
    return this.arrecadacoesCaixa
      .filter((arrecadacao) => arrecadacao.status === 'pendente')
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  get pendenciasFiltradas(): Arrecadacao[] {
    return this.arrecadacoesFiltradas.filter((arrecadacao) => arrecadacao.status === 'pendente');
  }

  /**
   * As vendas em aberto do caixa em foco, uma por linha.
   *
   * É a matéria-prima das contas: a lista mostra só o total de cada venda, e o
   * detalhe dos itens fica atrás do clique, para não transformar a aba numa
   * parede de item.
   */
  get vendasPendentes(): VendaPendente[] {    const grupos = new Map<string, Arrecadacao[]>();

    for (const item of this.pendenciasFiltradas) {
      const vendaId = item.venda_id ?? item.id;
      grupos.set(vendaId, [...(grupos.get(vendaId) ?? []), item]);
    }

    return [...grupos.entries()]
      .map(([vendaId, itens]) => {
        const primeiro = itens[0];
        return {
          vendaId,
          membro_id: primeiro.membro_id ?? null,
          caixa_id: primeiro.caixa_id ?? null,
          membro: primeiro.membro?.nome_completo || 'Membro não identificado',
          telefone: primeiro.membro?.telefone ?? '',
          email: primeiro.membro?.email ?? '',
          forma_pagamento: primeiro.forma_pagamento ?? 'dinheiro',
          data_venda: primeiro.data_venda,
          itens: [...itens].sort((a, b) => a.id.localeCompare(b.id)),
          total: itens.reduce((total, item) => total + Number(item.valor_total), 0),
          fiadoEmOutrosCaixas: this.fiadoForaDesteCaixa(primeiro)
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  /**
   * A conta de fiado de cada pessoa, com as vendas dela dentro.
   *
   * Comprar fiado duas vezes no mesmo caixa não abre duas contas: é a mesma
   * pessoa devendo, e a tela mostra uma linha só, com o total somado. As vendas
   * continuam separadas por dentro, porque cada uma tem data e itens próprios.
   */
  get contasMembro(): ContaMembro[] {
    const grupos = new Map<string, VendaPendente[]>();

    for (const venda of this.vendasPendentes) {
      const chave = this.chaveConta(venda);
      grupos.set(chave, [...(grupos.get(chave) ?? []), venda]);
    }

    return [...grupos.entries()]
      .map(([chave, vendas]) => {
        const maisAntigasPrimeiro = [...vendas].sort(
          (a, b) => new Date(a.data_venda).getTime() - new Date(b.data_venda).getTime()
        );
        return {
          chave,
          membro: vendas[0].membro,
          telefone: vendas[0].telefone,
          email: vendas[0].email,
          vendas: maisAntigasPrimeiro,
          vendaIds: vendas.map((venda) => venda.vendaId),
          total: vendas.reduce((total, venda) => total + venda.total, 0),
          // o aviso é da pessoa, não da venda: não adianta repetir a mesma
          // frase em cada linha da mesma conta
          fiadoEmOutrosCaixas: Math.max(...vendas.map((venda) => venda.fiadoEmOutrosCaixas))
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  /**
   * A identidade de uma conta de fiado: a pessoa e o caixa.
   *
   * O caixa entra na chave porque o dinheiro de um turno pertence àquela gaveta.
   * Sem ele, a conta de sábado se misturaria com a de domingo.
   */
  private chaveConta(venda: Pick<VendaPendente, 'membro_id' | 'caixa_id'>): string {
    return `${venda.membro_id ?? 'sem-membro'}::${venda.caixa_id ?? 'sem-caixa'}`;
  }

  /**
   * O que a mesma pessoa deve em outros caixas.
   *
   * Aparece como aviso, e não como item da conta: o dinheiro pertence ao caixa
   * onde a venda foi aberta, então quitá-lo junto bagunçaria a gaveta.
   */
  private fiadoForaDesteCaixa(referencia: Arrecadacao): number {
    if (!referencia.membro_id) return 0;

    return this.arrecadacoes
      .filter(
        (item) =>
          item.membro_id === referencia.membro_id &&
          item.status === 'pendente' &&
          (item.caixa_id ?? '') !== (referencia.caixa_id ?? '')
      )
      .reduce((total, item) => total + Number(item.valor_total), 0);
  }

  get totalPago(): number {
    return this.arrecadacoesCaixa
      .filter((arrecadacao) => arrecadacao.status === 'pago')
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  // --- A conta do caixa, em uma tela só ---
  //
  // Fica com nomes de letra porque o raciocínio é uma equação e o nome longo
  // atrapalha. A ideia é separada em getters para o número não ser repetido
  // em três lugares diferentes (tela, PDF e futuro cálculo no banco).

  /** x: tudo que foi vendido, inclusive o fiado. */
  get totalVendido(): number {
    return this.arrecadacoesCaixa
      .filter((item) => item.status !== 'cancelado')
      .reduce((total, item) => total + Number(item.valor_total), 0);
  }

  /** y: o que efetivamente entrou, por qualquer forma de pagamento. */
  get totalRecebido(): number {
    return this.arrecadacoesCaixa
      .filter((item) => item.status === 'pago')
      .reduce((total, item) => total + Number(item.valor_total), 0);
  }

  /** Só o dinheiro que ficou na gaveta. É o que dá para conferir com a mão. */
  get totalRecebidoEmDinheiro(): number {
    return this.arrecadacoesCaixa
      .filter((item) => item.status === 'pago' && (item.forma_pagamento ?? 'dinheiro') === 'dinheiro')
      .reduce((total, item) => total + Number(item.valor_total), 0);
  }

  /** s: o que saiu da gaveta para comprar algo, já tirando o troco que voltou. */
  get totalSaidasLiquido(): number {
    return this.saidasDoCaixa.reduce((total, saida) => total + Number(saida.valor_efetivo), 0);
  }

  /** i: o dinheiro que já estava na gaveta quando o caixa abriu. */
  /** O que a saída realmente consome da gaveta, já tirando o troco que voltou. */
  get valorLiquidoSaida(): number {
    return Number(this.novaSaida.valor ?? 0) - Number(this.novaSaida.troco ?? 0);
  }

  get valorInicial(): number {
    return Number(this.caixaEmFoco?.valor_abertura ?? 0);
  }

  /**
   * f: o que sobra para a igreja.
   *
   * Não entra o valor inicial porque ele não foi ganho na ação — é o troco
   * que já estava lá. Também não entra o fiado como recebido, porque fiado
   * não é dinheiro que voltou: ele aparece como positivo em `recebidoEmCaixa`.
   */
  get fechadoParaIgreja(): number {
    return this.totalRecebido - this.totalSaidasLiquido - this.valorInicial;
  }

  /** Quanto deveria ter na gaveta agora, contando o troco devolvido. */
  get valorEsperadoEmCaixa(): number {
    return this.valorInicial + this.totalRecebidoEmDinheiro - this.totalSaidasLiquido;
  }

  /** d: o que a contagem real diz contra o esperado. */
  get diferencaConferencia(): number {
    return (this.valorFechamentoInformado ?? 0) - this.valorEsperadoEmCaixa;
  }

  get temConferencia(): boolean {
    return this.valorFechamentoInformado !== null && this.valorFechamentoInformado !== undefined;
  }

  /** O tamanho da diferença, sem o sinal: o texto diz falta ou sobra. */
  get tamanhoDiferenca(): number {
    return Math.abs(this.diferencaConferencia);
  }

  /**
   * Quem está devendo, uma linha por pessoa.
   *
   * Mesmo agrupamento da aba de fiado: quem compra fiado duas vezes aparece uma
   * vez só, com as duas compras somadas. Senão o resumo falaria em dizer "2
   * pessoas" para alguém que está devendo uma vez só.
   */
  get devedores(): Devedor[] {
    const grupos = new Map<string, Arrecadacao[]>();

    for (const item of this.arrecadacoesCaixa) {
      if (item.status !== 'pendente') continue;
      const chave = this.chaveConta({ membro_id: item.membro_id ?? null, caixa_id: item.caixa_id ?? null });
      grupos.set(chave, [...(grupos.get(chave) ?? []), item]);
    }

    return [...grupos.entries()]
      .map(([chave, itens]) => ({
        chave,
        nome: itens[0].membro?.nome_completo || 'Membro não identificado',
        email: itens[0].membro?.email ?? '',
        telefone: itens[0].membro?.telefone ?? '',
        total: itens.reduce((total, item) => total + Number(item.valor_total), 0),
        vendas: new Set(itens.map((item) => item.venda_id ?? item.id)).size,
        dataVenda: itens.reduce(
          (maisRecente, item) => (item.data_venda > maisRecente ? item.data_venda : maisRecente),
          itens[0].data_venda
        ),
        itens: itens.map((item) => `${item.quantidade}x ${item.descricao}`).join(', ')
      }))
      .sort((a, b) => b.total - a.total);
  }


  /** Quantas vendas foram efetivamente pagas, contando a venda uma vez só. */
  get vendasPagas(): number {
    return new Set(
      this.arrecadacoesCaixa
        .filter((item) => item.status === 'pago')
        .map((item) => item.venda_id ?? item.id)
    ).size;
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

  get totalGeral(): number {
    return this.totalPago + this.totalPendente;
  }

  get quantidadeVendas(): number {
    return new Set(this.arrecadacoesCaixa.map((item) => item.venda_id ?? item.id)).size;
  }

  /**
   * As vendas do caixa em foco, uma por linha, com os itens dentro.
   *
   * Uma compra é um negócio só, mesmo tendo vários itens: mostrar um item por
   * linha faz a mesma compra aparecer várias vezes, e nada na tela diz que são
   * a mesma coisa.
   */
  get vendasResumo(): VendaAgrupada[] {
    return this.agruparVendas(this.arrecadacoesFiltradas);
  }

  setAba(aba: 'registrar' | 'pendentes' | 'resumo'): void {
    this.abaAtiva = aba;
    this.carrinhoAberto = false;
  }

  totalPorCategoria(categoria: 'bazar' | 'hamburgada' | 'feijoada'): number {
    return this.arrecadacoesCaixa
      .filter((arrecadacao) => arrecadacao.categoria === categoria)
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  totalPorForma(forma: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado'): number {
    return this.arrecadacoesCaixa
      .filter((arrecadacao) => (arrecadacao.forma_pagamento ?? 'dinheiro') === forma)
      .reduce((total, arrecadacao) => total + Number(arrecadacao.valor_total), 0);
  }

  /**
   * Conta vendas, não itens: uma venda de três itens em dinheiro é uma
   * venda, e é assim que quem lê o resumo espera ver.
   */
  quantidadePorForma(forma: 'pix' | 'debito' | 'credito' | 'dinheiro' | 'fiado'): number {
    return new Set(
      this.arrecadacoesCaixa
        .filter((arrecadacao) => (arrecadacao.forma_pagamento ?? 'dinheiro') === forma)
        .map((arrecadacao) => arrecadacao.venda_id ?? arrecadacao.id)
    ).size;
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
    this.etapaCarrinho = 'itens';
    this.pagamentoConfirmado = false;
  }

  abrirCarrinho(): void {
    this.carrinhoAberto = true;
    this.etapaCarrinho = 'itens';
    this.pagamentoConfirmado = false;
  }

  fecharCarrinho(): void {
    this.carrinhoAberto = false;
    this.etapaCarrinho = 'itens';
    this.pagamentoConfirmado = false;
  }

  abrirEtapaPagamento(): void {
    if (!this.carrinho.length) {
      return;
    }
    this.erro = '';
    this.etapaCarrinho = 'pagamento';
    this.pagamentoConfirmado = false;
  }

  voltarParaItens(): void {
    this.etapaCarrinho = 'itens';
    this.pagamentoConfirmado = false;
  }

  escolherFormaPagamentoNoCarrinho(forma: NonNullable<Arrecadacao['forma_pagamento']>): void {
    this.selecionarFormaPagamento(forma);
    this.pagamentoConfirmado = true;
    this.erro = '';
  }

  alternarVendaExpandida(vendaId: string): void {
    if (this.vendasExpandidas.has(vendaId)) {
      this.vendasExpandidas.delete(vendaId);
    } else {
      this.vendasExpandidas.add(vendaId);
    }
  }

  alternarContaExpandida(chave: string): void {
    if (this.contasExpandidas.has(chave)) {
      this.contasExpandidas.delete(chave);
    } else {
      this.contasExpandidas.add(chave);
    }
  }

  contaExpandida(chave: string): boolean {
    return this.contasExpandidas.has(chave);
  }

  vendaExpandida(vendaId: string): boolean {
    return this.vendasExpandidas.has(vendaId);
  }

  classePagamento(forma?: Arrecadacao['forma_pagamento']): string {
    return `pag-pill--${forma ?? 'dinheiro'}`;
  }

  private mostrarToastVendaRegistrada(): void {
    this.toastVendaRegistrada = true;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      this.toastVendaRegistrada = false;
    }, 2400);
  }

  private agruparVendas(lista: Arrecadacao[]): VendaAgrupada[] {
    const grupos = new Map<string, Arrecadacao[]>();

    for (const arrecadacao of lista) {
      const vendaId = arrecadacao.venda_id ?? arrecadacao.id;
      grupos.set(vendaId, [...(grupos.get(vendaId) ?? []), arrecadacao]);
    }

    return [...grupos.entries()]
      .map(([vendaId, itens]) => ({
        vendaId,
        membro: itens[0].membro?.nome_completo ?? '',
        categorias: [...new Set(itens.map((item) => item.categoria))],
        forma_pagamento: itens[0].forma_pagamento ?? 'dinheiro',
        status: itens.some((item) => item.status === 'pendente') ? 'pendente' as const : 'pago' as const,
        data_venda: itens[0].data_venda,
        observacoes: itens[0].observacoes,
        total: itens.reduce((total, item) => total + Number(item.valor_total), 0),
        itens
      }))
      .sort((a, b) => new Date(b.data_venda).getTime() - new Date(a.data_venda).getTime());
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

    const [membrosResponse, vendasResponse, caixasResponse] = await Promise.all([
      this.supabaseService.getMembros(),
      this.supabaseService.getVendasArrecadacao(),
      this.supabaseService.getTodasCaixas()
    ]);

    if (membrosResponse.error || vendasResponse.error || caixasResponse.error) {
      this.erro = 'Não foi possível carregar os dados das arrecadações.';
      console.error(membrosResponse.error || vendasResponse.error || caixasResponse.error);
    } else {
      this.membros = membrosResponse.data ?? [];
      this.arrecadacoes = this.normalizarVendas(vendasResponse.data ?? []);
      // mais recente primeiro: é a ordem em que a pessoa pensa nos turnos
      this.historicoCaixas = [...(caixasResponse.data ?? [])].sort(
        (a, b) => new Date(b.aberto_em).getTime() - new Date(a.aberto_em).getTime()
      );
    }

    // As saídas vêm numa consulta só, filtrando por todos os caixas já
    // carregados. Trazer só as do caixa aberto deixaria o histórico sem
    // os números de saída dos turnos passados.
    if (this.historicoCaixas.length) {
      const { data: saidas, error } = await this.supabaseService.getSaidasCaixa(
        this.historicoCaixas.map((caixa) => caixa.id)
      );
      if (error) {
        console.error(error);
      } else {
        this.saidas = saidas ?? [];
      }
    } else {
      this.saidas = [];
    }

    this.carregando = false;
  }

  async registrarLancamento(): Promise<void> {
    this.erro = '';

      if (!this.caixaAtual) {
    this.erro = 'Abra o caixa antes de registrar vendas.';
    return;
  }

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
      caixa_id: this.caixaAtual.id,
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
    this.carrinhoAberto = false;
    this.etapaCarrinho = 'itens';
    this.pagamentoConfirmado = false;
    this.mostrarToastVendaRegistrada();
    await this.carregarDados();
  }

    /** Quita a conta inteira: uma confirmação para todas as vendas da pessoa. */
  abrirModalPagamentoConta(conta: ContaMembro): void {
    this.erro = '';
    this.contaPagamento = {
      nome: conta.membro,
      total: conta.total,
      vendaIds: [...conta.vendaIds]
    };
    this.formaPagamentoQuitacao = 'dinheiro';
    this.modalPagamentoAberto = true;
  }

  fecharModalPagamento(): void {
    this.modalPagamentoAberto = false;
    this.contaPagamento = null;
  }

  /** Quita a conta inteira: uma chamada para todas as vendas da pessoa. */
  async confirmarPagamento(): Promise<void> {
    const conta = this.contaPagamento;
    if (!conta) {
      return;
    }

    this.salvando = true;
    const { error } = await this.supabaseService.marcarVendasArrecadacaoComoPagas(
      conta.vendaIds,
      this.formaPagamentoQuitacao
    );
    this.salvando = false;

    if (error) {
      this.erro = 'Não foi possível quitar a conta.';
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

  /**
   * Numeric do Postgres chega como string. Converter no template com `+` ou
   * `Number` não compila dentro de um componente Angular, então a conversão
   * mora aqui.
   */
  paraNumero(valor: number | string | null | undefined): number {
    return Number(valor ?? 0);
  }

  formatarData(data: string): string {
    return new Date(data).toLocaleDateString('pt-BR');
  }

  /**
   * O CSV é um relatório em três blocos: totais, saídas e vendas.
   * Quem abre no Excel vê primeiro a conta do caixa, que é a parte que
   * precisa bater com o papel.
   */
  /**
   * Monta o resumo do caixa em foco e joga para o serviço de relatório.
   *
   * A tela de histórico monta a mesma estrutura, então as duas geram
   * exatamente o mesmo papel a partir da mesma conta.
   */
  private dadosRelatorio(): DadosRelatorioCaixa {
    const caixa = this.caixaEmFoco;
    const filtros: string[] = [];

    if (this.filtroCategoria) filtros.push(`Ação: ${this.nomeCategoria(this.filtroCategoria)}`);
    if (this.filtroStatus) filtros.push(`Situação: ${this.filtroStatus}`);
    if (this.filtroBusca.trim()) filtros.push(`Busca: "${this.filtroBusca.trim()}"`);

    return {
      titulo: 'Resumo do caixa',
      subtitulo: caixa
        ? `Caixa de ${this.formatarData(caixa.aberto_em)} · ${caixa.status === 'aberto' ? 'em andamento' : 'encerrado'}`
        : 'Sem caixa em foco',
      dataEmissao: this.formatarDataHora(new Date().toISOString()),

      totalVendido: this.totalVendido,
      totalRecebido: this.totalRecebido,
      totalPendente: this.totalPendente,
      totalSaidas: this.totalSaidasLiquido,
      valorInicial: this.valorInicial,
      fechadoParaIgreja: this.fechadoParaIgreja,

      totalRecebidoDinheiro: this.totalRecebidoEmDinheiro,
      valorEsperadoEmCaixa: this.valorEsperadoEmCaixa,
      valorContado: this.valorFechamentoInformado,
      diferenca: this.temConferencia ? this.diferencaConferencia : null,

      porFormaPagamento: this.formasPagamento.map((forma) => ({
        nome: this.nomeFormaPagamento(forma),
        quantidade: this.quantidadePorForma(forma),
        total: this.totalPorForma(forma)
      })),
      porCategoria: (['bazar', 'hamburgada', 'feijoada'] as const).map((categoria) => ({
        nome: this.nomeCategoria(categoria),
        total: this.totalPorCategoria(categoria)
      })),

      saidas: this.saidasDoCaixa.map((saida) => ({
        data: this.formatarDataHora(saida.criado_em),
        motivo: saida.motivo,
        valor: Number(saida.valor),
        troco: Number(saida.troco),
        valorEfetivo: Number(saida.valor_efetivo)
      })),

      devedores: this.devedores.map((devedor) => ({
        nome: devedor.nome,
        email: devedor.email,
        telefone: devedor.telefone,
        total: devedor.total,
        vendas: devedor.vendas,
        dataVenda: this.formatarData(devedor.dataVenda),
        itens: devedor.itens
      })),

      vendas: this.arrecadacoesFiltradas.map((item) => ({
        descricao: item.descricao,
        dataVenda: this.formatarData(item.data_venda),
        categoria: this.nomeCategoria(item.categoria),
        quantidade: item.quantidade,
        valorTotal: Number(item.valor_total),
        formaPagamento: this.nomeFormaPagamento(item.forma_pagamento),
        situacao: item.status === 'pendente' ? 'Pendente' : 'Pago',
        membro: item.membro?.nome_completo ?? 'Avulso'
      })),

      filtros
    };
  }

  exportarPdf(): void {
    this.relatorioService
      .gerarPdf(this.dadosRelatorio())
      .save(`resumo-caixa-${this.dataAtual()}.pdf`);
  }

  exportarExcel(): void {
    const csv = this.relatorioService.gerarCsv(this.dadosRelatorio());
    // o BOM faz o Excel reconhecer UTF-8 e não comer o acento
    this.relatorioService.baixaArquivo(
      `resumo-caixa-${this.dataAtual()}.csv`,
      `\ufeff${csv}`,
      'text/csv;charset=utf-8;'
    );
  }

  private dataAtual(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private normalizarVendas(vendas: any[]): Arrecadacao[] {
    return vendas.flatMap((venda) => (venda.itens ?? []).map((item: any) => ({
      id: item.id,
      venda_id: venda.id,
      caixa_id: venda.caixa_id, 
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

  private novoId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

abrirModalAberturaCaixa(): void {
  this.erro = '';
  this.observacoesAberturaCaixa = '';
  this.valorAberturaCaixa = 0;
  this.modalAberturaCaixaAberto = true;
}

fecharModalAberturaCaixa(): void {
  this.modalAberturaCaixaAberto = false;
}

async confirmarAberturaCaixa(): Promise<void> {
  this.erro = '';
  const valor = Number(this.valorAberturaCaixa ?? 0);
  if (valor < 0) {
    this.erro = 'O valor de abertura não pode ser negativo.';
    return;
  }

  this.salvando = true;
  const { error } = await this.supabaseService.abrirCaixa(
    valor,
    this.observacoesAberturaCaixa.trim() || null
  );
  this.salvando = false;

  if (error) {
    this.erro = 'Não foi possível abrir o caixa.';
    console.error(error);
    return;
  }

  this.modalAberturaCaixaAberto = false;
  this.abaAtiva = 'registrar';
  await Promise.all([this.carregarCaixa(), this.carregarDados()]);
}

abrirModalFechamentoCaixa(): void {
  this.erro = '';
  this.observacoesFechamentoCaixa = '';
  this.valorFechamentoInformado = null;
  this.modalFechamentoCaixaAberto = true;
}

fecharModalFechamentoCaixa(): void {
  this.modalFechamentoCaixaAberto = false;
}

async confirmarFechamentoCaixa(): Promise<void> {
  this.erro = '';

  if (this.valorFechamentoInformado === null || this.valorFechamentoInformado === undefined) {
    this.erro = 'Conte o dinheiro que sobrou na gaveta para fechar o caixa.';
    return;
  }

  this.salvando = true;
  // o banco recalcula o esperado com base no dinheiro e nas saídas;
  // o que a pessoa contou é a informação nova que entra aqui
  const { error } = await this.supabaseService.fecharCaixa(
    Number(this.valorFechamentoInformado),
    this.observacoesFechamentoCaixa.trim() || null
  );
  this.salvando = false;

  if (error) {
    this.erro = 'Não foi possível fechar o caixa.';
    console.error(error);
    return;
  }

  this.modalFechamentoCaixaAberto = false;
  this.caixaAtual = null;
  this.valorFechamentoInformado = null;
  this.observacoesFechamentoCaixa = '';
  this.observacoesAberturaCaixa = '';
  this.limparCarrinho();
  this.limparFormulario();
  // Fechado o caixa não há aba visível: a tela é só o convite a abrir o
  // próximo. Registrar é onde a pessoa cai quando o caixa reabrir.
  this.abaAtiva = 'registrar';
  await Promise.all([this.carregarCaixa(), this.carregarDados()]);
}

  abrirModalSaidaCaixa(): void {
    this.erro = '';
    this.saidaEmEdicao = null;
    this.novaSaida = { valor: null, troco: 0, motivo: '' };
    this.modalSaidaAberto = true;
  }

  /**
   * Corrige uma saída já registrada.
   *
   * O caso de uso érir e gastar menos: pegou 30, gastou 20, os 10 voltam para
   * a gaveta. Em vez de inventar um lançamento de "devolução", a saída é
   * corrigida — o valor da gaveta continua batendo com o que foi gasto.
   */
  abrirModalEdicaoSaida(saida: SaidaCaixa): void {
    this.erro = '';
    this.saidaEmEdicao = saida;
    this.novaSaida = {
      valor: Number(saida.valor),
      troco: Number(saida.troco),
      motivo: saida.motivo
    };
    this.modalSaidaAberto = true;
  }

  fecharModalSaidaCaixa(): void {
    this.modalSaidaAberto = false;
    this.saidaEmEdicao = null;
  }

  async confirmarSaidaCaixa(): Promise<void> {
    this.erro = '';

    const emEdicao = this.saidaEmEdicao;

    if (!emEdicao && !this.caixaAtual) {
      this.erro = 'Só é possível registrar saída com o caixa aberto.';
      return;
    }

    const valor = Number(this.novaSaida.valor ?? 0);
    const troco = Number(this.novaSaida.troco ?? 0);
    const motivo = this.novaSaida.motivo.trim();

    if (valor <= 0) {
      this.erro = 'Informe quanto saiu do caixa.';
      return;
    }
    if (troco < 0 || troco > valor) {
      this.erro = 'O troco não pode ser maior que o valor retirado.';
      return;
    }
    if (!motivo) {
      this.erro = 'Escreva o motivo da saída.';
      return;
    }

    this.salvando = true;
    const { error } = emEdicao
      ? await this.supabaseService.atualizarSaidaCaixa(emEdicao.id, { valor, troco, motivo })
      : await this.supabaseService.registrarSaidaCaixa(this.caixaAtual!.id, {
          valor,
          troco,
          motivo
        });
    this.salvando = false;

    if (error) {
      this.erro = emEdicao
        ? 'Não foi possível salvar a alteração da saída.'
        : 'Não foi possível registrar a saída.';
      console.error(error);
      return;
    }

    this.modalSaidaAberto = false;
    this.saidaEmEdicao = null;
    this.novaSaida = { valor: null, troco: 0, motivo: '' };
    await this.carregarDados();
  }

async excluirSaidaCaixa(saida: SaidaCaixa): Promise<void> {
  if (!confirm(`Excluir a saída de ${this.formatarMoeda(Number(saida.valor_efetivo))}?`)) {
    return;
  }

  this.erro = '';
  const { error } = await this.supabaseService.removerSaidaCaixa(saida.id);
  if (error) {
    this.erro = 'Não foi possível excluir a saída.';
    console.error(error);
    return;
  }

  await this.carregarDados();
}


formatarDataHora(data: string): string {
  return new Date(data).toLocaleString('pt-BR');
}

}
