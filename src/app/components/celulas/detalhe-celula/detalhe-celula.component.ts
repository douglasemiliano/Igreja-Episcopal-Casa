import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CelulaService } from '../../../services/celula.service';
import { PermissaoService } from '../../../services/permissao.service';
import { ToastService } from '../../../services/toast.service';
import { ModalConfirmacaoService } from '../../utils/modal-confirmacao/modal-confirmacao.service';
import { DetalheCelula, Participante, PapelCelula } from '../../../model/celula.model';
import { iniciaisDe, matizDe as matizDeAvatar, anosDeIgreja as anosDeIgrejaAvatar } from '../../../utils/avatar';

/**
 * Detalhe da célula: os dados, quem participa e a formação do grupo.
 *
 * Três coisas nesta tela, e nenhuma delas é a mesma:
 *
 *   * `podeEditar` — `gerenciar_celulas`: mudar os dados da célula, desativar,
 *     excluir. É configuração da igreja. O líder da célula não mexe aqui: ele
 *     monta o grupo, não edita o cadastro.
 *   * `podeFormar` — quem pode mexer no grupo DESTA célula: o papel de direção
 *     (pastor, administrador, secretaria) formando qualquer uma, ou o líder
 *     formando a própria. Vem de public.pode_vincular_esta_celula(), a mesma
 *     função que a RLS consulta, então a tela e o banco não têm como divergir.
 *   * `sou_lider`   — só para rotular quem conduz, e não para autorizar nada.
 */
@Component({
  selector: 'app-detalhe-celula',
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule],
  templateUrl: './detalhe-celula.component.html',
  styleUrl: './detalhe-celula.component.scss'
})
export class DetalheCelulaComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly celulasService = inject(CelulaService);
  private readonly permissao = inject(PermissaoService);
  private readonly toast = inject(ToastService);
  private readonly confirmacao = inject(ModalConfirmacaoService);

  readonly detalhe = signal<DetalheCelula | null>(null);
  readonly carregando = signal<boolean>(true);
  readonly erro = signal<string>('');
  readonly celulaId = signal<string>('');

  /** Abre e fecha o bloco de adicionar membro. */
  readonly mostrarFormacao = signal<boolean>(false);
  /** Membros que ainda não estão em célula nenhuma, para o seletor. */
  readonly livres = signal<{ id: string; nome: string }[]>([]);
  readonly escolhido = signal<string>('');
  readonly adicionando = signal<boolean>(false);

  readonly podeEditar = signal<boolean>(false);

  /**
   * Quem mexe no grupo DESTA célula: o papel de direção, ou o líder dela.
   *
   * É signal e não computed porque a resposta vem do banco. Um computed sobre
   * a chave `vincular_membros_celula` seria mais simples e estaria errado: a
   * chave é global, e quem a tem por concessão indevida não deveria ver o
   * botão em célula nenhuma. O banco é quem sabe.
   *
   * Começa `false`: enquanto não responde, ninguém mexe em grupo nenhum.
   */
  readonly podeFormar = signal<boolean>(false);

  readonly participantes = computed<Participante[]>(() => this.detalhe()?.participantes ?? []);

  async ngOnInit(): Promise<void> {
    this.permissao.carregar();
    this.podeEditar.set(this.celulasService.podeGerenciar);

    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.celulaId.set(id);

    if (!id) {
      this.erro.set('Célula não encontrada.');
      this.carregando.set(false);
      return;
    }

    await this.carregar();
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    this.erro.set('');

    try {
      this.detalhe.set(await this.celulasService.detalhe(this.celulaId()));
      this.podeFormar.set(await this.celulasService.podeFormarNa(this.celulaId()));

      if (this.podeFormar()) {
        this.livres.set(await this.celulasService.membrosLivres());
      }
    } catch (falha) {
      this.erro.set(falha instanceof Error ? falha.message : 'Não foi possível abrir a célula.');
    } finally {
      this.carregando.set(false);
    }
  }

  /**
   * Só busca a lista de livres quando o bloco está abrindo, e uma vez só: é uma
   * consulta que traz a igreja inteira e não muda enquanto ninguém é
   * adicionado.
   */
  async alternarFormacao(): Promise<void> {
    const abrindo = !this.mostrarFormacao();
    this.mostrarFormacao.set(abrindo);

    if (abrindo && this.livres().length === 0) {
      this.livres.set(await this.celulasService.membrosLivres());
    }
  }

  async adicionar(): Promise<void> {
    const membroId = this.escolhido();
    if (!membroId) {
      this.toast.erro('Escolha uma pessoa para adicionar.');
      return;
    }

    // A RLS já recusaria, e a recusa apareceria como erro genérico de banco. A
    // guarda existe para a pessoa entender o motivo, que é diferente do erro
    // de dado: o líder que caiu aqui está numa célula que não é dele.
    if (!this.podeFormar()) {
      this.toast.erro('Você só pode adicionar membros na célula que você lidera.');
      return;
    }

    this.adicionando.set(true);
    try {
      const resultado = await this.celulasService.adicionarMembro(this.celulaId(), membroId);
      if (resultado.status === 'erro') {
        this.toast.erro(resultado.mensagem ?? 'Não foi possível adicionar.');

        // A pessoa entrou em outra célula entre a lista e o clique. A lista de
        // livres ficou desatualizada, então recarrega.
        if (resultado.mensagem?.includes('outra célula')) {
          this.livres.set(await this.celulasService.membrosLivres());
        }
        return;
      }

      this.escolhido.set('');
      this.toast.sucesso('Membro adicionado à célula.');
      await this.carregar();
    } finally {
      this.adicionando.set(false);
    }
  }

  /** Promove a pessoa a líder, ou devolve o papel. */
  async promover(participante: Participante): Promise<void> {
    const alvo: PapelCelula = participante.papel === 'lider' ? 'membro' : 'lider';
    const resultado = await this.celulasService.definirPapel(
      this.celulaId(),
      participante.membro_id,
      alvo
    );

    if (resultado.status === 'erro') {
      this.toast.erro(resultado.mensagem ?? 'Não foi possível mudar o papel.');
      return;
    }

    this.toast.sucesso(alvo === 'lider' ? 'Agora é líder desta célula.' : 'Deixou de ser líder.');
    await this.carregar();
  }

  async remover(participante: Participante): Promise<void> {
    const confirmado = await this.confirmacao.confirmar(
      `Remover ${participante.nome} da célula? A pessoa continua membro da igreja, só fica sem célula.`,
      { titulo: 'Remover da célula', textoConfirmar: 'Remover', perigo: true }
    );
    if (!confirmado) return;

    const resultado = await this.celulasService.removerMembro(
      this.celulaId(),
      participante.membro_id
    );
    if (resultado.status === 'erro') {
      this.toast.erro(resultado.mensagem ?? 'Não foi possível remover.');
      return;
    }

    this.toast.sucesso('Membro removido da célula.');
    await this.carregar();
  }

  async excluir(): Promise<void> {
    const nome = this.detalhe()?.celula.nome ?? 'esta célula';
    const total = this.participantes().length;

    const confirmado = await this.confirmacao.confirmar(
      `Excluir ${nome}?`,
      {
        titulo: 'Excluir célula',
        textoConfirmar: 'Excluir',
        perigo: true,
        detalhes: [
          total
            ? `Os ${total} participantes saem da lista, mas continuam membros da igreja.`
            : 'A célula não tem participantes.',
          'Não dá para desfazer.'
        ]
      }
    );
    if (!confirmado) return;

    const resultado = await this.celulasService.excluir(this.celulaId());
    if (resultado.status === 'erro') {
      this.toast.erro(resultado.mensagem ?? 'Não foi possível excluir.');
      return;
    }

    this.toast.sucesso('Célula excluída.');
    await this.router.navigate(['/celulas']);
  }

  /** "Terças, 19:30" — o que a célula informou, omitindo o que faltar. */
  quando(): string {
    const celula = this.detalhe()?.celula;
    if (!celula) return '';

    const partes = [celula.dia_semana, this.hora(celula.horario)].filter(
      (parte): parte is string => !!parte
    );
    return partes.length ? partes.join(' · ') : 'Horário não informado';
  }

  /** O `time` do Postgres volta `HH:MM:SS`; o `:00` não interessa na tela. */
  private hora(horario?: string | null): string {
    return horario ? horario.slice(0, 5) : '';
  }

  /** Iniciais para o avatar, como na listagem de membros. */
  iniciais(participante: Participante): string {
    return iniciaisDe(participante.nome);
  }

  /** Matiz estável por pessoa, igual ao da listagem de membros. */
  matizDe(participante: Participante): number {
    return matizDeAvatar(participante.nome, participante.membro_id);
  }

  /** Anos completos desde a entrada; `null` quando não há data. */
  anosDeIgreja(participante: Participante): number | null {
    return anosDeIgrejaAvatar(participante.data_entrada);
  }
}
