import { ApplicationRef, createComponent, EnvironmentInjector, Injectable } from '@angular/core';
import { ModalConfirmacaoComponent } from './modal-confirmacao.component';

@Injectable({
  providedIn: 'root',
})
export class ModalConfirmacaoService {
  constructor(
    private appRef: ApplicationRef,
    private envInjector: EnvironmentInjector
  ) {}

  confirmar(mensagem: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const ref = createComponent(ModalConfirmacaoComponent, {
        environmentInjector: this.envInjector,
        hostElement: document.body
      });

      this.appRef.attachView(ref.hostView);
      ref.setInput('mensagem', mensagem);
      ref.changeDetectorRef.detectChanges();

      const sub = ref.instance.fechado.subscribe((resultado: boolean) => {
        sub.unsubscribe();
        ref.destroy();
        resolve(resultado);
      });
    });
  }
}