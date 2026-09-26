import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { ToastService } from './toast.service';

/** De quanto em quanto tempo procurar versão nova com o app aberto. */
const INTERVALO_CHECAGEM_MS = 10 * 60 * 1000;

/**
 * Service worker e atualização de versão do app.
 *
 * Sem isto, o comportamento padrão do Angular é o seguinte: o navegador
 * baixa o service worker novo, ele fica em `waiting`, e a nova versão só
 * entra em vigor quando **todas** as abas do app forem fechadas. Como o app
 * é PWA instalado na tela inicial e fica aberto por semanas, na prática a
 * versão nova nunca era ativada — e a saída era remover o app da tela inicial
 * e adicionar de novo.
 *
 * Aqui a versão pronta vira um aviso com botão, e a verificação passa a
 * acontecer quando o app abre, quando ele volta do segundo plano e de tempos
 * em tempos, em vez de esperar o intervalo padrão de 6 horas.
 */
@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  /** Versão nova baixada e pronta para virar a ativa. */
  readonly atualizacaoPronta = signal(false);

  /** Procura em andamento — inclui o download da versão nova. */
  readonly verificando = signal(false);

  private iniciado = false;

  /**
   * Começa a vigiar. Idempotente de propósito: o initializer roda uma vez
   * por bootstrap, mas nada impede alguém chamar de novo.
   */
  iniciar(): void {
    if (this.iniciado || !this.swUpdate.isEnabled) return;
    this.iniciado = true;

    /*
     * VERSION_READY chega quando o worker novo terminou de baixar tudo e
     * está esperando. É o ponto em que recarregar já traz a versão nova.
     */
    this.swUpdate.versionUpdates.subscribe(() => this.anunciar());

    // Abrir o app pelo ícone é o momento em que a rede está provavelmente
    // disponível; é a melhor hora para olhar se há versão nova.
    this.document.addEventListener('visibilitychange', () => {
      if (this.document.visibilityState === 'visible') void this.verificar();
    });

    // E mesmo com o app aberto, parado na tela, sem nenhuma interação.
    setInterval(() => void this.verificar(), INTERVALO_CHECAGEM_MS);

    void this.verificar();
  }

  /**
   * Procura versão nova. A promessa só resolve quando o download terminou,
   * então o estado `verificando` serve de indicador de progresso.
   */
  async verificar(): Promise<boolean> {
    if (!this.swUpdate.isEnabled || this.verificando()) return false;

    this.verificando.set(true);

    try {
      const achou = await this.swUpdate.checkForUpdate();
      if (achou) this.anunciar();
      return achou;
    } catch (erro) {
      // Sem rede, por exemplo. Não é erro de verdade: a próxima tentativa
      // acontece no próximo resume ou no próximo intervalo.
      console.warn('Não foi possível procurar atualização do app:', erro);
      return false;
    } finally {
      this.verificando.set(false);
    }
  }

  /**
   * Ativa a versão que já estava esperando e recarrega. O primeiro reload é o
   * que pega a versão nova; os seguintes já saem com ela.
   */
  async aplicar(): Promise<void> {
    if (!this.swUpdate.isEnabled) return;

    try {
      await this.swUpdate.activateUpdate();
    } catch (erro) {
      console.error('Não foi possível ativar a nova versão:', erro);
      return;
    }

    this.document.defaultView?.location.reload();
  }

  /**
   * O que o gesto de arrastar executa: procura versão nova e recarrega em
   * qualquer caso. Se havia versão nova, ela já foi aplicada; se não havia,
   * um reload normal é o que o usuário queria de todo modo.
   */
  async recarregar(): Promise<void> {
    const tinhaNovaVersao = await this.verificar();

    if (tinhaNovaVersao) {
      await this.aplicar();
      return;
    }

    this.document.defaultView?.location.reload();
  }

  private anunciar(): void {
    // O VERSION_READY e o checkForUpdate avisam a mesma coisa; dois avisos
    // para o mesmo download seria dois toasts.
    if (this.atualizacaoPronta()) return;

    this.atualizacaoPronta.set(true);
    this.toast.comAcao('Nova versão do aplicativo disponível.', {
      rotulo: 'Atualizar agora',
      executar: () => void this.aplicar(),
    });
  }
}
