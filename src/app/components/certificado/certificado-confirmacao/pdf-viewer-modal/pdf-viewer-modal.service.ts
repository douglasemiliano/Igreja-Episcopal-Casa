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
    const ref = createComponent(PdfViewerModalComponent, {
      environmentInjector: this.envInjector,
      hostElement: document.body
    });

    this.appRef.attachView(ref.hostView);
    ref.setInput('pdfBlob', pdfBlob);
    ref.setInput('fileName', fileName);
    ref.changeDetectorRef.detectChanges();

    const sub = ref.instance.fechado.subscribe(() => {
      sub.unsubscribe();
      ref.destroy();
    });
  }
}