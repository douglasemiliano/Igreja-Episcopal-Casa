import { nomeExibicao } from './nome-exibicao';

describe('nomeExibicao', () => {
  it('reduz nome completo em caixa alta ao primeiro e ao último', () => {
    expect(nomeExibicao('DOUGLAS HENRIQUE EMILIANO DE OLIVEIRA LIMA')).toBe(
      'Douglas Lima'
    );
  });

  it('mantém nome de duas partes como está, só com caixa normal', () => {
    expect(nomeExibicao('Hermany Soares')).toBe('Hermany Soares');
  });

  it('pula partícula antes do sobrenome', () => {
    expect(nomeExibicao('Josenilda de Fatima Bezerra')).toBe('Josenilda Bezerra');
  });

  it('ignora partícula que antecipa o sobrenome', () => {
    expect(nomeExibicao('MARIA DAS GRAÇAS SOUZA')).toBe('Maria Souza');
  });

  it('preserva acentos e caixa do sobrenome composto', () => {
    expect(nomeExibicao('JOÃO DA SILVA-MENEZES')).toBe('João Silva-Menezes');
  });

  it('não inventa sobrenome quando o nome é único', () => {
    expect(nomeExibicao('MADALENA')).toBe('Madalena');
  });

  it('devolve vazio para entrada ausente em vez de "undefined"', () => {
    expect(nomeExibicao(null)).toBe('');
    expect(nomeExibicao(undefined)).toBe('');
    expect(nomeExibicao('   ')).toBe('');
  });

  it('normaliza espaços extras', () => {
    expect(nomeExibicao('  DOUGLAS   LIMA  ')).toBe('Douglas Lima');
  });
});
