import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  mensagem: string;
  tipo: 'info' | 'success' | 'error';
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

  fechar(id: number): void {
    this.toasts.update((lista) => lista.filter((t) => t.id !== id));
  }

  private push(mensagem: string, tipo: Toast['tipo']): void {
    const id = ++this.contador;
    this.toasts.update((lista) => [...lista, { id, mensagem, tipo }]);
    setTimeout(() => this.fechar(id), 3000);
  }
}