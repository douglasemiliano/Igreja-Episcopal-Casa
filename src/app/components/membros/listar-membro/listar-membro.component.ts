import { Component, inject, OnInit } from '@angular/core';
import { SupabaseService } from '../../../services/supabase.service';
import { PermissaoService } from '../../../services/permissao.service';
import { ToastService } from '../../../services/toast.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ConfirmacaoMembro, Membro } from '../../../model/membro.model';
import { ModalConfirmacaoService } from '../../utils/modal-confirmacao/modal-confirmacao.service';
import { iniciaisDe, matizDe as matizDeAvatar, anosDeIgreja as anosDeIgrejaAvatar } from '../../../utils/avatar';

type FiltroStatus = 'todos' | 'confirmados' | 'pendentes';

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
  private readonly confirmacao = inject(ModalConfirmacaoService);

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
   * Confirmar ainda depende de roles, porque não existe chave que a descreva.
   * Excluir passou a ter a chave `excluir_membros`
   * (supabase/20260927_excluir_membro_e_conta.sql) — a operação derruba a
   * conta de login, e botão escondido não é proteção: quem chamar a função
   * direto é barrado no banco pela mesma chave.
   */
  get podeCadastrar(): boolean {
    return this.permissao.pode('cadastrar_membros');
  }

  get podeExcluir(): boolean {
    return this.permissao.pode('excluir_membros') || this.temPermissao(['administrador', 'secretaria']);
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

  confirmacoesDe(membro: Membro): ConfirmacaoMembro[] {
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
    return iniciaisDe(membro.nome_completo ?? '');
  }

  /** Matiz estável por pessoa (mesma cor em todas as telas). */
  matizDe(membro: Membro): number {
    return matizDeAvatar(membro.nome_completo ?? '', membro.id);
  }

  /** Anos completos desde a entrada. `null` quando não há data. */
  anosDeIgreja(membro: Membro): number | null {
    return anosDeIgrejaAvatar(membro.data_entrada);
  }

  /*
   * O oficiante era uma string fixa no código ("Hermany Soares"). Isso grava no
   * histórico de `confirmacoes_membros` o nome de uma pessoa específica sempre
   * que alguém clica em Confirmar, mesmo em churches onde a confirmação é feita
   * por outra pessoa — e o registro fica errado sem nenhum aviso.
   *
   * Agora o nome é perguntado. A tela de confirmação de batismo já pede o bispo
   * num campo do próprio formulário, então segue o mesmo caminho.
   */
  /** Membro cuja confirmação está aberta, ou null quando nenhuma está. */
  confirmando: Membro | null = null;
  oficiante = '';
  salvandoConfirmacao = false;

  abrirConfirmacao(membro: Membro): void {
    this.oficiante = '';
    this.confirmando = membro;
  }

  fecharConfirmacao(): void {
    this.confirmando = null;
    this.oficiante = '';
  }

  async confirmarMembro(): Promise<void> {
    const membro = this.confirmando;
    if (!membro || this.salvandoConfirmacao) return;

    const nome = this.oficiante.trim();
    if (!nome) {
      this.toast.erro('Informe quem está oficializando a confirmação.');
      return;
    }

    this.salvandoConfirmacao = true;
    try {
      const { error } = await this.supabaseService.confirmarMembro(membro.id, {
        data_confirmacao: new Date().toISOString(),
        oficiante: nome,
        observacoes: ''
      });

      if (error) {
        console.error(error);
        this.toast.erro('Erro ao confirmar membro.');
        return;
      }

      this.toast.sucesso(`${membro.nome_completo} foi confirmado(a).`);
      this.fecharConfirmacao();
      this.carregarMembros(true);
    } catch (erro) {
      console.error(erro);
      this.toast.erro('Erro ao confirmar membro.');
    } finally {
      this.salvandoConfirmacao = false;
    }
  }

  /**
   * Exclui o membro e derruba a conta dele.
   *
   * O `confirm()` nativo foi trocado pelo modal do projeto porque a operação
   * parou de ser reversível: junto com a conta vai o perfil, e a pessoa não
   * consegue mais entrar. O modal lista o que vai acontecer antes de perguntar.
   */
  async deletarMembro(membro: Membro): Promise<void> {
    const previa = await this.supabaseService.previaExclusaoMembro(membro.id);

    const detalhes: string[] = [
      'O registro sai da lista de membros.',
    ];

    if (previa.temConta) {
      detalhes.push('A conta de login é excluída. A pessoa não consegue mais entrar.');
      if (previa.publicacoes > 0) {
        const plural = previa.publicacoes === 1 ? 'publicação fica' : 'publicações ficam';
        detalhes.push(
          `${previa.publicacoes} ${plural} no mural ${previa.publicacoes === 1 ? 'fica' : 'ficam'} ` +
            'sem autor. O texto é preservado, mas o nome some.'
        );
      }
      detalhes.push('Não dá para desfazer.');
    } else {
      detalhes.push('Esta pessoa nunca entrou no sistema, então não há conta a excluir.');
    }

    const confirmou = await this.confirmacao.confirmar(
      previa.temConta
        ? `Excluir ${membro.nome_completo} e a conta de login dela?`
        : `Remover ${membro.nome_completo} da lista de membros?`,
      {
        titulo: previa.temConta ? 'Excluir membro e conta' : 'Remover da lista',
        detalhes,
        textoConfirmar: previa.temConta ? 'Excluir tudo' : 'Remover',
        perigo: previa.temConta,
      }
    );

    if (!confirmou) return;

    const resultado = await this.supabaseService.excluirMembroEConta(membro.id);
    if (resultado.status !== 'ok') {
      this.toast.erro(resultado.mensagem ?? 'Erro ao excluir membro.');
      return;
    }

    this.membros = this.membros.filter((m) => m.id !== membro.id);
    this.refiltrar(true);
    this.toast.sucesso(
      resultado.conta_excluida ? 'Membro e conta excluídos.' : 'Membro removido.'
    );
  }
}
