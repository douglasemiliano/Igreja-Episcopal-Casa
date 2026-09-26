import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Toast, ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [],
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastContainerComponent {
  readonly toastService = inject(ToastService);

  /** Fecha o toast e só então roda a ação, para ela poder recarregar a página. */
  executar(toast: Toast): void {
    this.toastService.fechar(toast.id);
    toast.acao?.executar();
  }
}
