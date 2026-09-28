import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-modal-confirmacao',
  standalone: true,
  imports: [],
  templateUrl: './modal-confirmacao.component.html',
  styleUrls: ['./modal-confirmacao.component.scss']
})
export class ModalConfirmacaoComponent implements AfterViewInit {
  @Input() mensagem = '';

  /**
   * Extensões para confirmação destrutiva.
   *
   * Tudo opcional e com padrão igual ao comportamento antigo, então quem já
   * chama `confirmar(mensagem)` continua funcionando sem mudar nada.
   */
  @Input() titulo = 'Confirmação';
  /** Lista de consequências, para o caso em que "não" precisa saber do risco. */
  @Input() detalhes: string[] = [];
  @Input() textoConfirmar = 'Sim';
  @Input() textoCancelar = 'Não';
  /** Botão de confirmação em vermelho, para o que não tem volta. */
  @Input() perigo = false;

  @Output() fechado = new EventEmitter<boolean>();

  @ViewChild('modalElement') modalElement!: ElementRef<HTMLDivElement>;

  private resultado = false;
  private modal: any;

  ngAfterViewInit(): void {
    const Bootstrap = (window as any).bootstrap;
    if (!Bootstrap) return;

    this.modal = new Bootstrap.Modal(this.modalElement.nativeElement, {
      backdrop: 'static',
      keyboard: false
    });

    this.modalElement.nativeElement.addEventListener('hidden.bs.modal', () => {
      this.fechado.emit(this.resultado);
    });

    this.modal.show();
  }

  confirmar(): void {
    this.resultado = true;
    this.modal?.hide();
  }

  cancelar(): void {
    this.resultado = false;
    this.modal?.hide();
  }
}