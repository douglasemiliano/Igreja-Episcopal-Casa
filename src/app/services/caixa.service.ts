import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

/** Linha de `caixas` com status `aberto`, ou null se não há caixa aberta. */
export type CaixaAberto = Record<string, any> | null;

/**
 * Caixa aberta no momento.
 *
 * A tela de arrecadações e o dashboard precisam do mesmo dado, e as duas
 * chamavam `getCaixaAberto()` por conta própria — mais uma vez aqui, no
 * boot, para todo mundo, inclusive quem não tem nada a ver com caixa. A
 * consulta é compartilhada e o resultado fica num sinal.
 */
@Injectable({ providedIn: 'root' })
export class CaixaService {
  private readonly supabaseService = inject(SupabaseService);

  private readonly caixa = signal<CaixaAberto>(null);

  /** Caixa aberta, legível por template. `null` enquanto não carregou. */
  readonly caixaAtual = this.caixa.asReadonly();

  /** `true` depois da primeira consulta — mesmo que não haja caixa. */
  private consultou = false;
  private emVoo: Promise<CaixaAberto> | null = null;
  private ultimaConsulta = 0;

  /**
   * Devolve a caixa aberta, indo ao banco só quando ainda não se consultou
   * nesta janela. `forcar` existe para quem acabou de abrir ou fechar uma
   * caixa e precisa do estado novo na hora.
   */
  async carregarCaixa(forcar = false): Promise<CaixaAberto> {
    if (!forcar && this.emVoo) return this.emVoo;
    if (!forcar && this.consultou && Date.now() - this.ultimaConsulta < 30_000) {
      return this.caixa();
    }

    this.emVoo = this.buscar();
    try {
      return await this.emVoo;
    } finally {
      this.emVoo = null;
    }
  }

  private async buscar(): Promise<CaixaAberto> {
    const { data, error } = await this.supabaseService.getCaixaAberto();

    // Falhou: mantém o que já estava em tela em vez de trocar por nada.
    if (error) {
      console.error(error);
      return this.caixa();
    }

    this.caixa.set(data ?? null);
    this.consultou = true;
    this.ultimaConsulta = Date.now();
    return this.caixa();
  }

  /**
   * Aponta para outra caixa sem ir ao banco. Usado ao abrir e ao fechar,
   * que já sabem o resultado e não devem esperar outra consulta.
   */
  definir(caixa: CaixaAberto): void {
    this.caixa.set(caixa);
    this.consultou = true;
    this.ultimaConsulta = Date.now();
  }

  /** Esquece tudo, para o próximo login não herdar a caixa da sessão anterior. */
  limpar(): void {
    this.caixa.set(null);
    this.consultou = false;
    this.ultimaConsulta = 0;
  }
}
