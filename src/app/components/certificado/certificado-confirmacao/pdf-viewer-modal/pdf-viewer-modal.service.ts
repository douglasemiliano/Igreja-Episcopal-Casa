import { ApplicationRef, createComponent, EnvironmentInjector, Injectable } from '@angular/core';
import { PdfViewerModalComponent } from './pdf-viewer-modal.component';

@Injectable({
  providedIn: 'root',
})
export class PdfViewerModalService {
  constructor(
    private appRef: ApplicationRef,
    private envInjector: EnvironmentInjector
  ) {}

  abrir(pdfBlob: Blob, fileName: string): void {
    // Um div descartável, e não o próprio body. O elemento informado em
    // `hostElement` é usado como host do componente e o `destroy()` remove esse
    // host da árvore — passar `document.body` derrubaria o body inteiro, e com
    // ele o `<app-root>`, na primeira vez que o visualizador de PDF fechasse.
    // Mesmo defeito que o `ModalConfirmacaoService` tinha.
    const container = document.createElement('div');
    container.className = 'pdf-viewer-modal-container';
    document.body.appendChild(container);

    const ref = createComponent(PdfViewerModalComponent, {
      environmentInjector: this.envInjector,
      hostElement: container
    });

    this.appRef.attachView(ref.hostView);
    ref.setInput('pdfBlob', pdfBlob);
    ref.setInput('fileName', fileName);
    ref.changeDetectorRef.detectChanges();

    const sub = ref.instance.fechado.subscribe(() => {
      sub.unsubscribe();

      // `detachView` antes de `destroy`: sem isso a view continua na lista do
      // ApplicationRef depois de destruída, e o próximo `tick()` do app passa
      // por ela.
      this.appRef.detachView(ref.hostView);
      ref.destroy();
      container.remove();
    });
  }
}