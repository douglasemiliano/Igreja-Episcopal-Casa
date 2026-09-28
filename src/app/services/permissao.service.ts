import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

/**
 * Capacidades do usuário corrente, lidas do banco uma única vez.
 *
 * Substitui os arrays de roles espalhados por rotas, menu e componentes. Uma
 * capacidade é uma chave nomeada ("publicar_evento"), e quem define quais
 * papéis a possuem é a tabela `permissoes_roles` — administrável na tela
 * /permissoes.
 *
 * A segurança NÃO está aqui. Isto é só o que a interface esconde. A
 * imposição é a RLS, que consulta public.pode() no banco. Se as duas listas
 * divergirem, o que vale é a do banco, e a tela é a que mente.
 */
@Injectable({ providedIn: 'root' })
export class PermissaoService {
  private readonly supabase = inject(SupabaseService);

  private readonly conjunto = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * O conjunto em si, exposto para quem precisar reagir a mudanças — um
   * `effect` no lugar de subscription. Ler isto é o que registra a
   * dependência.
   */
  readonly capacidades = this.conjunto.asReadonly();

  /**
   * `readonly` + arrow de propósito: os templates chamam `permissao.pode(...)`
   * sem receiver, e uma propriedade comum perderia o `this` aí.
   */
  readonly pode = (chave: string): boolean => this.conjunto().has(chave);

  /**
   * Cache da consulta. O AuthGuard chama carregar() em toda navegação
   * protegida; sem isto, cada ida para uma página seria uma ida ao banco.
   */
  private emVoo: Promise<void> | null = null;
  private ultimaCarga = 0;

  /** Recarrega no máximo uma vez por janela, para não inundar o console. */
  private avisoDeFalha = false;

  get carregado(): boolean {
    return this.conjunto().size > 0;
  }

  /**
   * Busca o conjunto de capacidades. Segura a promessa em andamento para que
   * chamadas concorrentes compartilhem a mesma consulta.
   */
  async carregar(forcar = false): Promise<void> {
    if (!forcar && this.emVoo) return this.emVoo;
    if (!forcar && Date.now() - this.ultimaCarga < 30_000) return;

    this.emVoo = this.buscar();
    try {
      await this.emVoo;
    } finally {
      this.emVoo = null;
    }
  }

  private async buscar(): Promise<void> {
    try {
      // `minhasPermissoes` já lança quando o banco recusa, então o resultado
      // aqui é o array, e não o par { data, error }.
      const chaves = await this.supabase.minhasPermissoes();

      this.conjunto.set(new Set(chaves));
      this.ultimaCarga = Date.now();

      if (!this.avisoDeFalha) {
        console.info(`[permissões] ${chaves.length} capacidades carregadas.`);
      }
    } catch (erro) {
      /*
       * Falhou a consulta, e o fallback assume o pior: nenhuma capacidade.
       * Esconder é o comportamento seguro — um botão escondido que some é
       * reversível, um botão liberado que não deveria é um incidente.
       */
      this.conjunto.set(new Set<string>());

      if (!this.avisoDeFalha) {
        this.avisoDeFalha = true;
        console.error(
          '[permissões] Não foi possível carregar as capacidades. A interface vai ' +
            'ocultar tudo que depende de permissão.',
          erro
        );
      }
    }
  }

  /**
   * Recarrega quando a aba volta a ficar visível.
   *
   * É o ponto que faz a tela de permissões servir para alguma coisa: ela pode
   * mudar as permissões de quem está logado, e a pessoa só descobre na
   * próxima tela.
   *
   * A chamada NÃO é forçada, e é aqui que isso importa. Como o app é um PWA
   * instalado, alternar entre abas dispara `visibilitychange` o dia inteiro;
   * forçar transformava cada troca de aba numa consulta, que é exatamente o
   * que a janela de 30s de `carregar()` existe para evitar. Passados 30s sem
   * lookup, a próxima volta de aba já traz o conjunto novo.
   */
  async aoVoltarParaAba(): Promise<void> {
    if (document.visibilityState !== 'visible') return;
    await this.carregar();
  }

  /**
   * Invalida o cache. Usado no logout, para o próximo login recarregar em vez
   * de herdar o conjunto do usuário anterior.
   */
  limpar(): void {
    this.conjunto.set(new Set<string>());
    this.ultimaCarga = 0;
    this.avisoDeFalha = false;
  }
}
