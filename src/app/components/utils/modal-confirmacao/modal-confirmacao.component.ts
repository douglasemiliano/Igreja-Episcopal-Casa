import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-modal-confirmacao',
  standalone: true,
  imports: [],
  templateUrl: './modal-confirmacao.component.html',
  styleUrls: ['./modal-confirmacao.component.scss']
})
export class ModalConfirmacaoComponent implements AfterViewInit, OnDestroy {
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
  private aoEsconder = () => this.fechado.emit(this.resultado);

  ngAfterViewInit(): void {
    const Bootstrap = (window as any).bootstrap;

    if (!Bootstrap) {
      // Sem o Bootstrap na página não existe modal, e sem modal não existe
      // clique. Emitir aqui, e não em silêncio, é o que impede o `await` de
      // quem chamou de ficar pendurado para sempre — que para o usuário
      // parece exatamente a tela travada.
      //
      // O setTimeout existe porque o `fechado` é assinado DEPOIS do
      // detectChanges que dispara este ngAfterViewInit: um emit síncrono
      // ninguém escuta e o mesmo travamento volta por outro caminho.
      setTimeout(() => this.fechado.emit(false), 0);
      return;
    }

    this.modal = new Bootstrap.Modal(this.modalElement.nativeElement, {
      backdrop: 'static',
      keyboard: false
    });

    this.modalElement.nativeElement.addEventListener('hidden.bs.modal', this.aoEsconder);

    this.modal.show();
  }

  ngOnDestroy(): void {
    // O listener vive no elemento do Bootstrap, que sobrevive a este
    // componente se algo destruir a view antes da animação terminar. Sem tirar
    // o listener, o `fechado` dispara sobre um componente morto.
    this.modalElement?.nativeElement?.removeEventListener('hidden.bs.modal', this.aoEsconder);
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
