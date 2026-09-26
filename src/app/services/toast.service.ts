import { Injectable, signal } from '@angular/core';

export interface ToastAcao {
  rotulo: string;
  executar: () => void;
}

export interface Toast {
  id: number;
  mensagem: string;
  tipo: 'info' | 'success' | 'error';
  /** Botão opcional. Quando existe, a mensagem não some sozinha. */
  acao?: ToastAcao;
  /** Em milissegundos. 0 significa que o toast fica até o usuário fechar. */
  duracao: number;
}

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  private contador = 0;
  readonly toasts = signal<Toast[]>([]);

  mostrar(mensagem: string): void {
    this.push(mensagem, 'info');
  }

  sucesso(mensagem: string): void {
    this.push(mensagem, 'success');
  }

  erro(mensagem: string): void {
    this.push(mensagem, 'error');
  }

  /**
   * Aviso que depende de uma ação do usuário. Não expira: um botão que
   * desaparece sozinho some junto com a única chance de agir nele.
   */
  comAcao(mensagem: string, acao: ToastAcao, tipo: Toast['tipo'] = 'info'): void {
    this.push(mensagem, tipo, acao, 0);
  }

  fechar(id: number): void {
    this.toasts.update((lista) => lista.filter((t) => t.id !== id));
  }

  private push(mensagem: string, tipo: Toast['tipo'], acao?: ToastAcao, duracao = 3000): void {
    const id = ++this.contador;
    this.toasts.update((lista) => [...lista, { id, mensagem, tipo, acao, duracao }]);

    if (duracao > 0) {
      setTimeout(() => this.fechar(id), duracao);
    }
  }
}
