import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { PermissaoService } from './permissao.service';
import {
  AvaliacaoCadastro,
  DadosCompletarCadastro,
  MembroVinculo,
  ResultadoOperacao,
  StatusVinculoResposta,
} from '../model/membro.model';

/**
 * Papéis que não passam pela tela de completar cadastro.
 *
 * Secretaria e administração cadastram membros pela própria tela
 * `/membros/cadastrar`; a etapa de onboarding é para quem entrou por conta
 * própria. Obrigar os dois grupos criaria um beco sem saída: a secretaria
 * ficaria presa numa tela até preencher o próprio cadastro, e qualquer falha
 * ali bloquearia o painel inteiro.
 */
const PAPEIS_DISPENSAM_CADASTRO = ['administrador', 'secretaria', 'pastor'];

/**
 * Coage `verificado` para booleano.
 *
 * `cadastro_verificado_em` é timestamptz no banco, e timestamptz vira TEXTO no
 * JSON. A tela decide comparando com `true`, e nenhum timestamp em string é
 * igual a `true` — então a conta que já preencheu o cadastro continuava sendo
 * tratada como "nunca preencheu" e era devolvida para a tela, para sempre.
 *
 * `!!valor` cobre os três casos que o banco produz: timestamp preenchido
 * (verdadeiro), `null` de nunca ter passado por ali, e o `false` explícito.
 */
function normalizarVerificado(resposta: StatusVinculoResposta): StatusVinculoResposta {
  const bruto = resposta as StatusVinculoResposta & { verificado?: string | boolean | null };

  return { ...resposta, verificado: !!bruto.verificado };
}

/**
 * Vínculo entre a conta de login e o registro em `membros`.
 *
 * `profiles` (conta) e `membros` (pessoa da igreja) nasceram como tabelas
 * soltas: sem FK, sem trigger, sem join. Esta classe é a frente do banco que
 * costura as duas — ver supabase/20260927_vincular_membros.sql.
 *
 * O estado tem cinco desfechos, e só um é o caminho feliz:
 *
 *   vinculado     a conta foi casada com um membro que já existia pelo email
 *   pre_cadastro  não bateu com ninguém, então foi aberta uma linha incompleta
 *   ambiguo       dois membros em aberto com o mesmo email — ninguém é vinculado
 *   sem_email     a conta não tem email (acesso por telefone, por exemplo)
 *   erro          a função não respondeu
 *
 * `ambiguo` e `sem_email` não viram pré-cadastro de propósito: no primeiro
 * caso qualquer vínculo escolhido errado liga a conta à pessoa errada; no
 * segundo não há com quem casar. Os dois vão para a mesma tela, que explica o
 * que aconteceu e manda falar com a secretaria.
 */
@Injectable({ providedIn: 'root' })
export class MembroVinculoService {
  private readonly supabase = inject(SupabaseService);
  private readonly permissao = inject(PermissaoService);

  private readonly estado = signal<StatusVinculoResposta | null>(null);

  /** `null` enquanto não consultou — distingue "não sei" de "não tem". */
  readonly resposta = this.estado.asReadonly();

  readonly carregando = signal<boolean>(false);

  /**
   * Verdadeiro quando a pessoa precisa passar pela tela de cadastro.
   *
   * Vale nos dois desfechos do vinculo, e nao so no pre-cadastro:
   *
   *   - pre_cadastro/ambiguo/sem_email: nao ha nada pronto, e obrigatorio;
   *   - vinculado sem `verificado`: o registro ja existia, provavelmente foi
   *     lancado a mao pela secretaria e pode estar sem telefone, endereco ou
   *     nascimento. A tela aparece uma vez para a pessoa conferir.
   *
   * `verificado` e o que impede a tela de voltar em todo login, entao ele nao
   * pode ser confundido com `completo`: um registro completo pode nunca ter
   * passado pela tela, e um pre-cadastro recusado e carimbado do mesmo jeito.
   */
  readonly precisaCompletar = computed<boolean>(() => {
    const atual = this.estado();
    if (!atual) return false;
    if (atual.status === 'pre_cadastro' || atual.status === 'ambiguo' || atual.status === 'sem_email') {
      return true;
    }
    return atual.status === 'vinculado' && atual.verificado !== true;
  });

  /**
   * Distingue "abrir um cadastro do zero" de "conferir o que ja existe", para a
   * tela trocar o texto. `null` enquanto nao consultou.
   */
  readonly ehPreCadastro = computed<boolean>(() => {
    const atual = this.estado();
    if (!atual) return false;
    if (atual.status === 'pre_cadastro') return true;
    // So ambiguousos e sem_email nao tem linha; a tela deles mostra o aviso de
    // bloqueio e nao o formulario.
    return atual.status === 'vinculado' && atual.completo !== true;
  });

  /** Já tem membro completo, pode seguir normalmente. */
  readonly completo = computed<boolean>(() => {
    const atual = this.estado();
    return atual?.status === 'vinculado' && atual.completo === true;
  });

  private emVoo: Promise<StatusVinculoResposta> | null = null;

  private dispensadoCache: boolean | null = null;
  private dispensadoEmVoo: Promise<boolean> | null = null;

  /**
   * Consulta (ou refaz) o vínculo.
   *
   * `entrarNoMembro` é idempotente no banco, então repetir é seguro. Ainda
   * assim isto é cacheado por sessão: o CadastroGuard roda em toda navegação
   * protegida e não há motivo para ir ao banco a cada ida de página.
   */
  async carregar(forcar = false): Promise<StatusVinculoResposta> {
    if (!forcar && this.emVoo) return this.emVoo;
    if (!forcar && this.estado()) return this.estado()!;

    this.carregando.set(true);
    this.emVoo = this.supabase.entrarNoMembro();
    try {
      const resposta = await this.emVoo;
      /*
       * O estado é a fonte da verdade de `precisaCompletar`, que decide se a
       * pessoa entra ou fica na tela. `verificado` chega do banco como
       * timestamptz, ou seja, texto. A comparação é com `true`, então texto
       * nenhum casa e o vinculo parece nunca ter sido confirmado.
       *
       * Normalizar aqui, e não só no SupabaseService, é o que garante a
       * forma do sinal independente de quem chamou. É este ponto que o
       * estado recebe o valor, então é aqui que ele tem de ficar certo.
       */
      this.estado.set(normalizarVerificado(resposta));
      return this.estado()!;
    } finally {
      this.emVoo = null;
      this.carregando.set(false);
    }
  }

  /** Lê o membro ligado sem efeito colateral nenhum. */
  async meuMembro(): Promise<MembroVinculo> {
    return this.supabase.meuMembro();
  }

  /**
   * Decide se a pessoa pode seguir para `url` ou precisa completar o cadastro.
   *
   * Mora aqui, e não num guard, por dois motivos.
   *
   * Primeiro: um `CanActivateFn` só tem `inject()` disponível quando é o
   * router que o invoca. Se o AuthGuard chamar a função do guard diretamente,
   * `inject()` estoura NG0203 — porque um método de classe não é contexto de
   * injeção. Serviço resolve o problema na raiz, e a regra fica num lugar só.
   *
   * Segundo: a checagem precisa acontecer dentro do AuthGuard, e não como
   * guard de rota. Se ficasse em `canActivate` de cada linha do array de rotas,
   * a próxima rota que alguém adicionasse nasceria sem a verificação.
   */
  async avaliar(url: string): Promise<AvaliacaoCadastro> {
    // Já está onde precisa estar. Sem isto, redirecionar aqui seria laço.
    if (url.includes('/completar-cadastro')) return { pode: true };

    const isDispensado = await this.jaDispensado();
    if (isDispensado) return { pode: true };

    await this.permissao.carregar();
    const resposta = await this.carregar();

    if (resposta.status === 'erro') {
      /*
       * A função não respondeu. Não bloquear: pode ser a migration ainda não
       * aplicada, ou queda de rede. Trancar o app inteiro atrás de uma tela que
       * provavelmente também falharia é o pior dos dois lados.
       */
      console.warn(
        '[cadastro] Não foi possível verificar o vínculo, seguindo sem trava.',
        resposta
      );
      return { pode: true };
    }

    if (!this.precisaCompletar()) return { pode: true };

    return { pode: false, motivo: resposta.status };
  }

  /**
   * `getRoles()` faz duas consultas ao banco, e o AuthGuard roda em toda
   * navegação protegida. O papel raramente muda no meio da sessão, então a
   * resposta fica guardada até o logout — quando `limpar()` roda e o próximo
   * login reavalia.
   */
  private async jaDispensado(): Promise<boolean> {
    if (this.dispensadoCache !== null) return this.dispensadoCache;

    if (!this.dispensadoEmVoo) {
      this.dispensadoEmVoo = (async () => {
        const roles = await this.supabase.getRoles();
        return roles.some((role) => PAPEIS_DISPENSAM_CADASTRO.includes(role));
      })();
    }

    try {
      this.dispensadoCache = await this.dispensadoEmVoo;
    } finally {
      this.dispensadoEmVoo = null;
    }

    return this.dispensadoCache;
  }

  /**
   * Envia o preenchimento. A escrita é feita por SECURITY DEFINER no banco,
   * que só aceita mexer na linha cujo user_id é o do próprio auth.uid().
   */
  async completar(dados: DadosCompletarCadastro): Promise<ResultadoOperacao> {
    const resultado = await this.supabase.completarMeuCadastro(dados);
    // Recarrega para o AuthGuard liberar a navegação.
    if (resultado.status === 'ok') await this.carregar(true);
    return resultado;
  }

  /**
   * Sai da tela sem preencher.
   *
   * Fica aqui, e não no componente, pelo mesmo motivo de `completar`: sem o
   * `carregar(true)` o estado em cache continua dizendo "precisa completar", o
   * AuthGuard lê esse cache na navegação seguinte e devolve a pessoa para a
   * mesma tela. O botão parecia não funcionar e o app travava nela.
   *
   * Falhar aqui é um caso diferente de falhar no `completar`: aqui não houve
   * erro de escrita, então o toast deve dizer só que não deu, e a pessoa segue
   * na tela para tentar de novo.
   */
  async pularAtualizacao(): Promise<ResultadoOperacao> {
    const resultado = await this.supabase.pularAtualizacaoCadastral();
    if (resultado.status === 'ok') await this.carregar(true);
    return resultado;
  }

  /** Logout: o próximo login não pode herdar o vínculo do usuário anterior. */
  limpar(): void {
    this.estado.set(null);
    this.emVoo = null;
    this.dispensadoCache = null;
    this.dispensadoEmVoo = null;
  }
}
