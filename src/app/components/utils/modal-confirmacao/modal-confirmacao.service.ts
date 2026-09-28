import { ApplicationRef, ComponentRef, createComponent, EnvironmentInjector, Injectable } from '@angular/core';
import { ModalConfirmacaoComponent } from './modal-confirmacao.component';

export interface OpcoesConfirmacao {
  titulo?: string;
  detalhes?: string[];
  textoConfirmar?: string;
  textoCancelar?: string;
  perigo?: boolean;
}

/**
 * Modal de confirmação.
 *
 * O modal nasce e morre por chamada, sem ficar na árvore de nenhuma tela, e é
 * por isso que ele é montado à mão com `createComponent` em vez de ser uma
 * `<app-modal-confirmacao>` no template de quem chama. O preço é que o
 * container e a view são gerenciados aqui, e é aí que mora o cuidado deste
 * arquivo — ver `montarContainer()` e `encerrar()`.
 */
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
      const container = this.montarContainer();

      const ref: ComponentRef<ModalConfirmacaoComponent> = createComponent(ModalConfirmacaoComponent, {
        environmentInjector: this.envInjector,
        hostElement: container
      });

      this.appRef.attachView(ref.hostView);
      ref.setInput('mensagem', mensagem);
      if (opcoes.titulo !== undefined) ref.setInput('titulo', opcoes.titulo);
      if (opcoes.detalhes !== undefined) ref.setInput('detalhes', opcoes.detalhes);
      if (opcoes.textoConfirmar !== undefined) ref.setInput('textoConfirmar', opcoes.textoConfirmar);
      if (opcoes.textoCancelar !== undefined) ref.setInput('textoCancelar', opcoes.textoCancelar);
      if (opcoes.perigo !== undefined) ref.setInput('perigo', opcoes.perigo);
      ref.changeDetectorRef.detectChanges();

      // A assinatura acontece DEPOIS do detectChanges acima, e é por isso que o
      // `fechado` do componente precisa ser emitido de forma assíncrona mesmo
      // quando ele não tem nada a fazer: um emit síncrono aqui não encontraria
      // esta linha e a promise nunca resolveria.
      let assinatura: { unsubscribe(): void } | undefined;
      let encerrado = false;

      const encerrar = (resultado: boolean): void => {
        // `hidden.bs.modal` e o clique podem chegar juntos. Duas chamadas de
        // destroy no mesmo ComponentRef derrubam o app inteiro, e a segunda
        // viria da animação ainda em curso.
        if (encerrado) return;
        encerrado = true;
        assinatura?.unsubscribe();

        // `detachView` ANTES de `destroy`. `attachView` no topo registrou a
        // view na lista do ApplicationRef, e `destroy` sozinho não a tira de
        // lá: sobraria uma view destruída na lista, e o próximo `tick()` — que
        // dispara no instante em que o `await` do chamador volta — tentaria
        // rodar change detection nela.
        this.appRef.detachView(ref.hostView);
        ref.destroy();

        // O `destroy` acima pode ter removido o host do DOM, ou não, conforme
        // a versão do Angular trate `hostElement` como host ou como pai. Nos
        // dois casos `remove()` é no-op ou fecha a conta, e o que ele nunca
        // pode tocar é o body: é o elemento que o modal NÃO pode usar de
        // host. Ver `montarContainer()`.
        container.remove();

        resolve(resultado);
      };

      assinatura = ref.instance.fechado.subscribe(encerrar);
    });
  }

  /**
   * Um `<div>` descartável para o modal, dentro do body.
   *
   * Existe por causa de uma armadilha do `createComponent`: o elemento
   * informado em `hostElement` é usado como HOST do componente, e o
   * `ComponentRef.destroy()` remove esse host da árvore. Passar `document.body`
   * — que é o que esta classe fazia — significa que o primeiro modal que
   * fechasse derrubava o body inteiro, e com ele o `<app-root>`. Na tela isso
   * aparece como a página inteira branca em qualquer confirmação: Remover da
   * célula, Excluir célula, Excluir membro.
   *
   * Um div próprio não tem nada de bonito, mas tem uma propriedade que importa:
   * errar o `destroy` custa um div vazio no body, nunca a aplicação.
   */
  private montarContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'modal-confirmacao-container';
    document.body.appendChild(container);
    return container;
  }
}
