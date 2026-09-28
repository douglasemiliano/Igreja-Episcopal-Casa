/**
 * Células da igreja.
 *
 * A referência de quem pertence a uma célula é sempre o par (celula_id,
 * membro_id): `membro_id` é único, e isso é a regra de domínio "um membro
 * participa de no máximo uma célula", imposta pelo índice
 * `celula_membros_membro_unico` no banco — não pela interface. Ver
 * supabase/20260930_celulas.sql.
 */

export type PapelCelula = 'membro' | 'lider';

export interface Celula {
  id: string;
  nome: string;
  descricao?: string | null;
  /**
   * Texto livre, não enum: a igreja escreve "terças", "quarta e sexta",
   * "sábado de manhã", e um CHECK com dias da semana obrigaria a cadastrar
   * "quarta e sexta" como duas células diferentes.
   */
  dia_semana?: string | null;
  local?: string | null;
  /** `time` no banco; o PostgREST devolve como string `HH:MM` ou `HH:MM:SS`. */
  horario?: string | null;
  ativa: boolean;
  criado_em?: string | null;
}

/** Uma célula como a listagem desenha: a célula mais o que ela tem dentro. */
export interface CelulaComResumo extends Celula {
  /** Quantas pessoas participam, líderes incluídos. */
  total_membros?: number;
  /** Nomes dos líderes, para o cartão da listação mostrar quem conduz. */
  lideres?: string[];
  /** `true` quando a conta logada lidera esta célula. */
  sou_lider?: boolean;
}

/** Uma participação: a pessoa e o papel dela naquela célula. */
export interface Participante {
  membro_id: string;
  nome: string;
  papel: PapelCelula;
  telefone?: string | null;
  email?: string | null;
  criado_em?: string | null;
}

/** O detalhe da célula: os dados dela e quem participa. */
export interface DetalheCelula {
  celula: Celula;
  participantes: Participante[];
  /** `true` quando a conta logada lidera esta célula. */
  sou_lider: boolean;
}

export interface DadosCelula {
  nome: string;
  descricao?: string | null;
  dia_semana?: string | null;
  local?: string | null;
  /** `HH:MM`, como o `<input type="time">` entrega. */
  horario?: string | null;
  ativa?: boolean;
}

/**
 * Resultado de toda escrita de célula.
 *
 * `status: 'ok'` com `id` devolve a célula afetada, para a tela navegar sem
 * refazer a consulta. `mensagem` é sempre texto que a pessoa pode ler: a
 * tradução do erro do banco acontece no serviço, e nenhum código do Postgres
 * chega ao toast.
 */
export interface ResultadoCelula {
  status: 'ok' | 'erro';
  id?: string | null;
  mensagem?: string;
}

/**
 * Uma célula da conta logada, vinda de public.minhas_celulas().
 *
 * O banco devolve array — mesmo quando vazio — de propósito, para o front não
 * precisar distinguir "sem célula" de "consulta quebrada".
 */
export interface MinhaCelula {
  id: string;
  nome: string;
  papel: PapelCelula;
}

/** O banco devolve jsonb sem garantia de forma. */
export function normalizarPapel(bruto: unknown): PapelCelula {
  return bruto === 'lider' ? 'lider' : 'membro';
}

/**
 * `minhas_celulas()` pode devolver null se a função mudar de forma, ou se a
 * chamada falhar de um jeito que o PostgREST reporte como sucesso. Nos dois
 * casos a tela tem de mostrar "sem célula", e não quebrar em `.map()`.
 */
export function normalizarMinhasCelulas(bruto: unknown): MinhaCelula[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((item): item is MinhaCelula => !!item && typeof (item as MinhaCelula).id === 'string')
    .map((item) => ({
      id: item.id,
      nome: item.nome ?? 'Célula',
      papel: normalizarPapel(item.papel)
    }));
}
