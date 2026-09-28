/**
 * Avatar com iniciais e matiz estável por pessoa. Usado tanto na listagem de
 * membros quanto na lista de participantes de uma célula, para as duas telas
 * desenharem a mesma pessoa do mesmo jeito.
 */

export const MATIZES = [212, 262, 340, 22, 44, 158, 190, 286];

/** Iniciais para o avatar. Não há foto, então o nome é a âncora. */
export function iniciaisDe(nome: string): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].charAt(0).toUpperCase();

  const meio = partes.length > 2
    ? partes.find((parte, i) => i > 0 && i < partes.length - 1 && parte.length > 2)
    : undefined;

  return (partes[0].charAt(0) + (meio ?? partes[partes.length - 1]).charAt(0)).toUpperCase();
}

/**
 * Matiz estável por pessoa: o mesmo nome sai sempre na mesma cor, e nomes
 * parecidos não colidem, porque a soma é feita sobre o texto inteiro.
 */
export function matizDe(nome: string, id: string): number {
  const texto = nome || id;
  let soma = 0;
  for (let i = 0; i < texto.length; i++) {
    soma = (soma * 31 + texto.charCodeAt(i)) % 100000;
  }
  return MATIZES[soma % MATIZES.length];
}

/** Anos completos desde a entrada. `null` quando não há data. */
export function anosDeIgreja(data: string | null | undefined): number | null {
  if (!data) return null;
  const entrada = new Date(data);
  if (isNaN(entrada.getTime())) return null;

  const hoje = new Date();
  let anos = hoje.getFullYear() - entrada.getFullYear();
  const aindaFaltam = hoje.getMonth() < entrada.getMonth()
    || (hoje.getMonth() === entrada.getMonth() && hoje.getDate() < entrada.getDate());
  if (aindaFaltam) anos--;
  return anos > 0 ? anos : null;
}