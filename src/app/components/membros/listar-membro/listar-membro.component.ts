import { Component, inject, OnInit } from '@angular/core';
import { SupabaseService } from '../../../services/supabase.service';
import { PermissaoService } from '../../../services/permissao.service';
import { ToastService } from '../../../services/toast.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

interface Confirmacao {
  id: string;
  data_confirmacao: string;
  oficiante?: string;
}

interface Membro {
  id: string;
  nome_completo: string;
  email?: string | null;
  telefone?: string | null;
  funcao?: string | null;
  data_entrada?: string | null;
  data_nascimento?: string | null;
  /** PostgREST devolve `null` sem relação e um array com relação. */
  confirmacao?: Confirmacao[] | Confirmacao | null;
}

type FiltroStatus = 'todos' | 'confirmados' | 'pendentes';

/** Matizes espalhados o bastante para dois nomes vizinhos não sairem iguais. */
const MATIZES = [212, 262, 340, 22, 44, 158, 190, 286];

@Component({
  selector: 'app-listar-membro',
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule],
  templateUrl: './listar-membro.component.html',
  styleUrl: './listar-membro.component.scss'
})
export class ListarMembrosComponent implements OnInit {
  private readonly supabaseService = inject(SupabaseService);
  private readonly permissao = inject(PermissaoService);
  private readonly toast = inject(ToastService);

  membros: Membro[] = [];
  /** Resultado do filtro, guardado em vez de recalculado no template. */
  private filtrados: Membro[] = [];
  roles: string[] = ['membro'];

  filtro = '';
  status: FiltroStatus = 'todos';
  pagina = 1;
  itensPorPagina = 12;
  readonly opcoesPagina = [12, 24, 48, 96];
  carregando = true;

  ngOnInit() {
    this.supabaseService.getRoles().then((roles) => { this.roles = roles; });
    this.permissao.carregar();
    this.carregarMembros();
  }

  temPermissao(roles: string[]): boolean {
    return roles.some((role) => this.roles.includes(role));
  }

  /**
   * A tela de cadastro tem chave no catálogo, então decide por ela.
   *
   * As ações de confirmar e excluir ainda dependem de roles, porque não existe
   * chave que as descreva — é uma das pendências da seção 3.3 do plano de
   * permissões. Quando as chaves existirem, é aqui que o papel sai.
   */
  get podeCadastrar(): boolean {
    return this.permissao.pode('cadastrar_membros');
  }

  async carregarMembros(preservarPagina = false) {
    this.carregando = true;
    try {
      const { data, error } = await this.supabaseService.getMembrosComConfirmacao();
      if (error) throw error;
      this.membros = (data ?? []) as Membro[];
      this.refiltrar(preservarPagina);
    } catch (erro) {
      console.error(erro);
      this.toast.erro('Erro ao carregar membros.');
    } finally {
      this.carregando = false;
    }
  }

  /**
   * Recalcula a lista visível. Antes esta lógica vivia em métodos chamados pelo
   * template, e cada chamada refazia o filtro e a fatiagem — quatro vezes por
   * change detection, sobre a lista inteira.
   */
  private refiltrar(preservarPagina = false): void {
    const termo = this.filtro.trim().toLowerCase();

    this.filtrados = this.membros.filter((membro) => {
      if (!this.casaNoTermo(membro, termo)) return false;
      if (this.status === 'confirmados') return this.eConfirmado(membro);
      if (this.status === 'pendentes') return !this.eConfirmado(membro);
      return true;
    });

    // Depois de confirmar ou excluir, a pessoa não deve ser jogada para a
    // primeira página. Se a última página ficou vazia, aí sim volta.
    const total = this.totalPaginas();
    this.pagina = !preservarPagina || this.pagina > total ? 1 : this.pagina;
  }

  private casaNoTermo(membro: Membro, termo: string): boolean {
    if (!termo) return true;
    return [membro.nome_completo, membro.email, membro.telefone, membro.funcao]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(termo);
  }

  applyFilter(event: Event): void {
    this.filtro = (event.target as HTMLInputElement).value;
    this.refiltrar();
  }

  applyStatus(valor: string): void {
    this.status = valor as FiltroStatus;
    this.refiltrar();
  }

  totalEncontrados(): number {
    return this.filtrados.length;
  }

  /**
   * O embed do PostgREST devolve `null` sem relação e um array com relação.
   * Checar a truthiness direto do campo erraria: `[]` é verdadeiro em JS, e
   * todo membro sem confirmação apareceria como confirmado.
   */
  eConfirmado(membro: Membro): boolean {
    if (Array.isArray(membro.confirmacao)) return membro.confirmacao.length > 0;
    return Boolean(membro.confirmacao);
  }

  confirmacoesDe(membro: Membro): Confirmacao[] {
    if (Array.isArray(membro.confirmacao)) return membro.confirmacao;
    return membro.confirmacao ? [membro.confirmacao] : [];
  }

  totalPaginas(): number {
    return Math.max(1, Math.ceil(this.filtrados.length / this.itensPorPagina));
  }

  /**
   * Janela de páginas com reticências: em vez de 40 botões, mostra no máximo
   * sete posições em torno da atual.
   */
  numerosPaginas(): (number | '…')[] {
    const total = this.totalPaginas();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const atual = this.pagina;
    const paginas = new Set<number>([1, total, atual]);
    for (const deslocamento of [-2, -1, 1, 2]) {
      const alvo = atual + deslocamento;
      if (alvo > 1 && alvo < total) paginas.add(alvo);
    }

    const ordenadas = [...paginas].sort((a, b) => a - b);
    const saida: (number | '…')[] = [];
    let anterior = 0;
    for (const pagina of ordenadas) {
      if (pagina - anterior > 1) saida.push('…');
      saida.push(pagina);
      anterior = pagina;
    }
    return saida;
  }

  membrosPaginados(): Membro[] {
    const inicio = (this.pagina - 1) * this.itensPorPagina;
    return this.filtrados.slice(inicio, inicio + this.itensPorPagina);
  }

  mudarPagina(pag: number): void {
    if (pag < 1 || pag > this.totalPaginas()) return;
    this.pagina = pag;
  }

  mudarTamanhoPagina(): void {
    this.pagina = 1;
  }

  /** Iniciais para o avatar. `membros` não tem foto, então o nome é a âncora. */
  iniciais(membro: Membro): string {
    const partes = (membro.nome_completo ?? '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].charAt(0).toUpperCase();

    const meio = partes.length > 2
      ? partes.find((parte, i) => i > 0 && i < partes.length - 1 && parte.length > 2)
      : undefined;

    return (partes[0].charAt(0) + (meio ?? partes[partes.length - 1]).charAt(0)).toUpperCase();
  }

  /**
   * Matiz estável por pessoa: o mesmo nome sai sempre na mesma cor, e nomes
   * parecidos não colidem, porque a soma é feita sobre o texto inteiro.
   */
  matizDe(membro: Membro): number {
    const nome = membro.nome_completo ?? membro.id;
    let soma = 0;
    for (let i = 0; i < nome.length; i++) {
      soma = (soma * 31 + nome.charCodeAt(i)) % 100000;
    }
    return MATIZES[soma % MATIZES.length];
  }

  /** Anos completos desde a entrada. `null` quando não há data. */
  anosDeIgreja(membro: Membro): number | null {
    if (!membro.data_entrada) return null;
    const entrada = new Date(membro.data_entrada);
    if (isNaN(entrada.getTime())) return null;

    const hoje = new Date();
    let anos = hoje.getFullYear() - entrada.getFullYear();
    const aindaFaltam = hoje.getMonth() < entrada.getMonth()
      || (hoje.getMonth() === entrada.getMonth() && hoje.getDate() < entrada.getDate());
    if (aindaFaltam) anos--;
    return anos > 0 ? anos : null;
  }

  async confirmarMembro(membro: Membro): Promise<void> {
    try {
      const { error } = await this.supabaseService.confirmarMembro(membro.id, {
        data_confirmacao: new Date().toISOString(),
        oficiante: 'Hermany Soares',
        observacoes: ''
      });

      if (error) {
        console.error(error);
        this.toast.erro('Erro ao confirmar membro.');
        return;
      }

      this.toast.sucesso(`${membro.nome_completo} foi confirmado(a).`);
      this.carregarMembros(true);
    } catch (erro) {
      console.error(erro);
      this.toast.erro('Erro ao confirmar membro.');
    }
  }

  async deletarMembro(membro: Membro): Promise<void> {
    if (!confirm(`Tem certeza que deseja deletar o membro ${membro.nome_completo}?`)) return;

    const { error } = await this.supabaseService.deleteMembro(membro.id);
    if (error) {
      console.error('Erro ao deletar:', error);
      this.toast.erro('Erro ao deletar membro.');
      return;
    }

    this.membros = this.membros.filter((m) => m.id !== membro.id);
    this.refiltrar(true);
    this.toast.sucesso('Membro removido.');
  }
}
