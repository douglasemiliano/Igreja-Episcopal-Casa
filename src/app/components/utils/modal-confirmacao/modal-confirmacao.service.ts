import { ApplicationRef, createComponent, EnvironmentInjector, Injectable } from '@angular/core';
import { ModalConfirmacaoComponent } from './modal-confirmacao.component';

export interface OpcoesConfirmacao {
  titulo?: string;
  detalhes?: string[];
  textoConfirmar?: string;
  textoCancelar?: string;
  perigo?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class ModalConfirmacaoService {
  constructor(
    private appRef: ApplicationRef,
    private envInjector: EnvironmentInjector
  ) {}

  /**
   * `opcoes` é opcional e tudo dentro dela tem padrão, então a chamada antiga
   * `confirmar(mensagem)` continua idêntica.
   */
  confirmar(mensagem: string, opcoes: OpcoesConfirmacao = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const ref = createComponent(ModalConfirmacaoComponent, {
        environmentInjector: this.envInjector,
        hostElement: document.body
      });

      this.appRef.attachView(ref.hostView);
      ref.setInput('mensagem', mensagem);
      if (opcoes.titulo !== undefined) ref.setInput('titulo', opcoes.titulo);
      if (opcoes.detalhes !== undefined) ref.setInput('detalhes', opcoes.detalhes);
      if (opcoes.textoConfirmar !== undefined) ref.setInput('textoConfirmar', opcoes.textoConfirmar);
      if (opcoes.textoCancelar !== undefined) ref.setInput('textoCancelar', opcoes.textoCancelar);
      if (opcoes.perigo !== undefined) ref.setInput('perigo', opcoes.perigo);
      ref.changeDetectorRef.detectChanges();

      const sub = ref.instance.fechado.subscribe((resultado: boolean) => {
        sub.unsubscribe();
        ref.destroy();
        resolve(resultado);
      });
    });
  }
}
