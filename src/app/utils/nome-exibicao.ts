/**
 * Partículas que antecedem o sobrenome. Em "Oliveira de Jesus", o sobrenome
 * é "Jesus" e o "de" é partícula — trocar pelo último token daria "de", que
 * sozinho não identifica ninguém. A última palavra que não for partícula é
 * o último nome.
 */
const PARTICULAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'd',
  'y',
  'ap',
  'a'
]);

/**
 * "DOUGLAS HENRIQUE EMILIANO DE OLIVEIRA LIMA" -> "Douglas Lima".
 *
 * Cabeçalho e sidebar têm largura contada em poucas dezenas de caracteres, e o
 * nome completo de umirmedo cadastrado em letra alta estouraba a linha. Só
 * o primeiro e o último nome resolvem sem perder quem é a pessoa.
 *
 * A capitalização entra junto porque o cadastro guarda quase tudo em caixa
 * alta, e "DOUGLAS LIMA" no cabeçalho destoa do resto da interface, que é
 * em caixa normal.
 *
 * Devolve o texto original quando não dá para reduzir com segurança (nome
 * único, ou entrada vazia) — inventar nome não é opção.
 */
export function nomeExibicao(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return '';

  const partes = limpo.split(' ');
  if (partes.length < 2) return caixaNormal(limpo);

  const ultimoIndice = ultimoNomeIndice(partes);
  if (ultimoIndice <= 0) return caixaNormal(limpo);

  return `${caixaNormal(partes[0])} ${caixaNormal(partes[ultimoIndice])}`;
}

/** Índice da última parte que não é partícula. */
function ultimoNomeIndice(partes: string[]): number {
  for (let i = partes.length - 1; i > 0; i--) {
    const palavra = partes[i].toLocaleLowerCase('pt-BR');
    if (!PARTICULAS.has(palavra)) return i;
  }
  return 0;
}

/**
 * Caixa de título respeitando acentos e hifens: "JOÃO DA SILVA-MENEZES" ->
 * "João da Silva-Menezes". Uma letra maiúscula solta no meio da palavra
 * viraria "Mcdonald".
 */
function caixaNormal(valor: string): string {
  return valor
    .toLocaleLowerCase('pt-BR')
    .replace(
      /(^|[^a-zà-ÿ])([a-zà-ÿ])/g,
      (_match, separador: string, letra: string) =>
        separador + letra.toLocaleUpperCase('pt-BR')
    );
}
