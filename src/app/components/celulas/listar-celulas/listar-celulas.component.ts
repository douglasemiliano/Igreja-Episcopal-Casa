import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CelulaService } from '../../../services/celula.service';
import { PermissaoService } from '../../../services/permissao.service';
import { ToastService } from '../../../services/toast.service';
import { CelulaComResumo } from '../../../model/celula.model';

/**
 * Listagem de células.
 *
 * Aberta a qualquer conta autenticada, como agenda e leccionário: quem entra
 * na igreja precisa saber em que célula está. O que a chave `gerenciar_celulas`
 * controla é o botão de criar, que aparece só para quem pode.
 */
@Component({
  selector: 'app-listar-celulas',
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule],
  templateUrl: './listar-celulas.component.html',
  styleUrl: './listar-celulas.component.scss'
})
export class ListarCelulasComponent implements OnInit {
  private readonly celulasService = inject(CelulaService);
  private readonly permissao = inject(PermissaoService);
  private readonly toast = inject(ToastService);

  readonly celulas = signal<CelulaComResumo[]>([]);
  readonly carregando = signal<boolean>(true);
  readonly erro = signal<string>('');
  readonly filtro = signal<string>('');
  /** Quando true, traz também as células inativas. */
  readonly mostrarInativas = signal<boolean>(false);

  readonly filtradas = computed(() => {
    const termo = this.filtro().trim().toLowerCase();
    if (!termo) return this.celulas();

    return this.celulas().filter((celula) =>
      [celula.nome, celula.dia_semana, celula.local, ...(celula.lideres ?? [])]
        .filter((campo): campo is string => typeof campo === 'string')
        .some((campo) => campo.toLowerCase().includes(termo))
    );
  });

  readonly podeGerenciar = computed(() => this.celulasService.podeGerenciar);

  ngOnInit(): void {
    this.permissao.carregar();
    this.carregar();
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    this.erro.set('');

    try {
      this.celulas.set(await this.celulasService.listar(!this.mostrarInativas()));
    } catch (falha) {
      const mensagem = falha instanceof Error ? falha.message : 'Não foi possível carregar as células.';
      this.erro.set(mensagem);
      this.toast.erro(mensagem);
    } finally {
      this.carregando.set(false);
    }
  }

  alternarInativas(): void {
    this.mostrarInativas.update((valor) => !valor);
    this.carregar();
  }

  /** "Terças, 19:30" — as partes que a célula informou, omitindo o que faltar. */
  quando(celula: CelulaComResumo): string {
    const partes = [celula.dia_semana, this.horaFormatada(celula.horario)].filter(
      (parte): parte is string => !!parte
    );
    return partes.length ? partes.join(' · ') : 'Horário não informado';
  }

  /**
   * O `time` do Postgres volta como `HH:MM:SS`, e o `HH:MM` do input é mais
   * curto. Cortar evita o `:00` sobrando na tela.
   */
  private horaFormatada(horario?: string | null): string {
    if (!horario) return '';
    return horario.slice(0, 5);
  }
}
