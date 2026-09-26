import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TAMANHO_MAXIMO_IMAGEM_MB } from '../../../services/supabase.service';
import { ToastService } from '../../../services/toast.service';

/**
 * Seletor de foto da publicação: mantém a pré-visualização local e emite a
 * intenção do usuário. Quem decide o que fazer com o arquivo é o pai, porque
 * a foto só deve ir para o storage quando a publicação for gravada.
 *
 * A imagem não é enviada aqui de propósito: cancelar o preenchimento não
 * deixaria arquivo órfão no bucket.
 */
@Component({
  selector: 'app-seletor-imagem',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './seletor-imagem.component.html',
  styleUrl: './seletor-imagem.component.scss'
})
export class SeletorImagemComponent implements OnDestroy {
  /** Foto já salva na publicação; vazia quando ainda não há nenhuma. */
  @Input() urlAtual = '';
  @Output() arquivo = new EventEmitter<File>();
  @Output() removido = new EventEmitter<void>();

  @ViewChild('input') input?: ElementRef<HTMLInputElement>;

  /** Object URL da pré-visualização; o arquivo só sobe no momento de salvar. */
  private previa = '';

  constructor(private toast: ToastService) {}

  get urlExibida(): string {
    return this.previa || this.urlAtual;
  }

  get temImagem(): boolean {
    return !!this.urlExibida;
  }

  abrirSelecao(): void {
    this.input?.nativeElement.click();
  }

  selecionarArquivo(event: Event): void {
    const alvo = event.target as HTMLInputElement;
    const escolhido = alvo.files?.[0];
    alvo.value = '';
    if (!escolhido) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(escolhido.type)) {
      this.toast.erro('Formato inválido. Use JPG, PNG ou WEBP.');
      return;
    }
    if (escolhido.size > TAMANHO_MAXIMO_IMAGEM_MB * 1024 * 1024) {
      this.toast.erro(`A imagem deve ter no máximo ${TAMANHO_MAXIMO_IMAGEM_MB} MB.`);
      return;
    }

    this.liberarPrevia();
    this.previa = URL.createObjectURL(escolhido);
    this.arquivo.emit(escolhido);
  }

  remover(): void {
    this.liberarPrevia();
    this.removido.emit();
  }

  /**
   * Limpa a prévia por fora. O pai precisa disso quando o componente não é
   * destruído junto com a tela — no composer, publicar esvazia o campo mas o
   * seletor continua na árvore, e sem isso a foto antiga ficava à vista.
   */
  limpar(): void {
    this.liberarPrevia();
  }

  ngOnDestroy(): void {
    this.liberarPrevia();
  }

  /** Object URL não é liberada pelo GC; segurar referência vazaria memória. */
  private liberarPrevia(): void {
    if (!this.previa) return;
    URL.revokeObjectURL(this.previa);
    this.previa = '';
  }
}
