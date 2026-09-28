export interface ConfirmacaoMembro {
  id: string;
  data_confirmacao: string;
  oficiante?: string;
}

export interface Membro {
  id: string;
  nome_completo: string;
  email?: string | null;
  telefone?: string | null;
  funcao?: string | null;
  data_entrada?: string | null;
  data_nascimento?: string | null;
  sexo?: string | null;
  endereco?: string | null;
  /** Colunas adicionadas em supabase/20260927_vincular_membros.sql. */
  user_id?: string | null;
  cadastro_completo?: boolean;
  /**
   * Quando a conta preencheu a tela de cadastro. NULL = ainda nao passou por
   * ela. Adicionado em supabase/20260928_atualizacao_cadastral.sql.
   */
  cadastro_verificado_em?: string | null;
  /** PostgREST devolve `null` sem relação e um array com relação. */
  confirmacao?: ConfirmacaoMembro[] | ConfirmacaoMembro | null;
}

/** Leitura do membro ligado à conta atual, vinda de public.meu_membro(). */
export interface MembroVinculo {
  existe: boolean;
  id?: string | null;
  nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  data_nascimento?: string | null;
  sexo?: string | null;
  endereco?: string | null;
  funcao?: string | null;
  completo: boolean;
  /**
   * `true` quando a conta ja passou pela tela de cadastro e nao deve mais ser
   * importunada. Ausente ou `false` = mostrar a tela.
   */
  verificado?: boolean;
}

export type StatusVinculo =
  | 'vinculado'
  | 'pre_cadastro'
  | 'ambiguo'
  | 'sem_email'
  | 'erro';

export interface StatusVinculoResposta {
  status: StatusVinculo;
  id?: string | null;
  nome?: string | null;
  completo?: boolean;
  /**
   * `true` quando a conta já passou pela tela. Sempre booleano, mesmo vindo do
   * banco como timestamptz em texto: a camada de serviço converte, porque a
   * comparação com `true` é o que decide a tela, e um timestamp em string
   * nunca seria igual a `true`.
   */
  verificado?: boolean;
  quantidade?: number;
  mensagem?: string;
}

export interface DadosCompletarCadastro {
  nome: string;
  telefone?: string | null;
  dataNascimento?: string | null;
  sexo?: string | null;
  endereco?: string | null;
  funcao?: string | null;
}

export interface ResultadoOperacao {
  status: 'ok' | 'erro' | 'sem_vinculo';
  id?: string | null;
  completo?: boolean;
  /** `membro_salvo` verdadeiro com `perfil_sincronizado` falso = salvou, mas o cabeçalho não acompanhou. */
  perfilSincronizado?: boolean;
  mensagem?: string;
}

/**
 * Campos que a pessoa edita no próprio cadastro.
 *
 * O mesmo conjunto de `DadosCompletarCadastro`, e por isso o mesmo formato: a
 * diferença entre as duas operações é o que elas FAZEM com esses campos — a
 * conclusão carimba a tela de cadastro, a edição de perfil não — e não o
 * conjunto. `data_entrada` e `nome_batismo` ficam de fora de propósito: são da
 * secretaria.
 */
export type DadosPerfilMembro = DadosCompletarCadastro;

/** O que a exclusão vai apagar, lido antes de pedir confirmação. */
export interface PreviaExclusao {
  nome?: string | null;
  /** `true` quando o membro tem `user_id` — isto é, existe conta a derrubar. */
  temConta: boolean;
  /** Publicações que ficarão sem autor, preservadas. */
  publicacoes: number;
}

export interface ResultadoExclusaoMembro {
  status: 'ok' | 'erro';
  mensagem?: string;
  conta_excluida?: boolean;
  publicacoes_sem_autor?: number;
}

/**
 * Resultado da checagem que decide se a pessoa precisa passar por
 * /completar-cadastro antes de seguir.
 */
export interface AvaliacaoCadastro {
  pode: boolean;
  /** Só preenchido quando `pode` é false: o que faltou. */
  motivo?: StatusVinculo;
}

/**
 * O banco devolve jsonb sem garantia de forma. Um status desconhecido é
 * tratado como 'erro' em vez de cair no primeiro caso de um switch e virar
 * "pré-cadastro" sem querer.
 */
export function normalizarStatus(bruto: unknown): StatusVinculoResposta {
  const dados = (bruto ?? {}) as StatusVinculoResposta;
  const conhecidos: StatusVinculo[] = ['vinculado', 'pre_cadastro', 'ambiguo', 'sem_email', 'erro'];
  return conhecidos.includes(dados.status) ? dados : { status: 'erro' };
}
