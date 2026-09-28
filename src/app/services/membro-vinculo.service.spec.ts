import { TestBed } from '@angular/core/testing';

import { SupabaseService } from './supabase.service';
import { PermissaoService } from './permissao.service';
import { MembroVinculoService } from './membro-vinculo.service';
import { StatusVinculoResposta } from '../model/membro.model';

/**
 * Regressão do botão "Agora não, fazer depois".
 *
 * O botão chamava a RPC direto, sem atualizar o estado em cache. A escrita no
 * banco dava certo e o toast aparecia, mas o AuthGuard lia o cache antigo na
 * navegação seguinte e devolvia a pessoa para a mesma tela — parecendo que o
 * botão não fazia nada e que o app inteiro estava travado.
 *
 * O que estes testes fixam: toda escrita que muda a situação tem de
 * CONSEGUIRIRSE com o `carregar(true)`, senão o guard trava a pessoa no
 * lugar.
 */
describe('MembroVinculoService', () => {
  let service: MembroVinculoService;

  let entrarNoMembro: jasmine.Spy;
  let getRoles: jasmine.Spy;
  let pularAtualizacaoCadastral: jasmine.Spy;

  const vinculadoCompletoVerificado = (): StatusVinculoResposta => ({
    status: 'vinculado',
    id: 'm1',
    nome: 'Maria Silva',
    completo: true,
    verificado: true,
  });

  const vinculadoCompletoNaoVerificado = (): StatusVinculoResposta => ({
    status: 'vinculado',
    id: 'm1',
    nome: 'Maria Silva',
    completo: true,
    verificado: false,
  });

  beforeEach(() => {
    entrarNoMembro = jasmine.createSpy('entrarNoMembro').and.resolveTo(vinculadoCompletoVerificado());
    getRoles = jasmine.createSpy('getRoles').and.resolveTo(['membro']);
    pularAtualizacaoCadastral = jasmine
      .createSpy('pularAtualizacaoCadastral')
      .and.resolveTo({ status: 'ok', id: 'm1' });

    TestBed.configureTestingModule({
      providers: [
        MembroVinculoService,
        {
          provide: SupabaseService,
          useValue: {
            entrarNoMembro,
            getRoles,
            pularAtualizacaoCadastral,
            meuMembro: jasmine.createSpy('meuMembro').and.resolveTo({ existe: false, completo: false }),
            completarMeuCadastro: jasmine.createSpy('completarMeuCadastro'),
          },
        },
        { provide: PermissaoService, useValue: { carregar: jasmine.createSpy('carregar').and.resolveTo(undefined) } },
      ],
    });
    service = TestBed.inject(MembroVinculoService);
  });

  it('libera a navegação para quem já passou pela tela', async () => {
    const avaliacao = await service.avaliar('/home');

    expect(avaliacao.pode).toBe(true);
  });

  it('prende quem vinculou com registro antigo e ainda não conferiu', async () => {
    entrarNoMembro.and.resolveTo(vinculadoCompletoNaoVerificado());

    const avaliacao = await service.avaliar('/home');

    // `completo` é true e ainda assim a tela aparece: o registro tem tudo, mas
    // a conta nunca viu os próprios dados.
    expect(avaliacao.pode).toBe(false);
  });

  it('libera a navegação depois de pular, em vez de devolver para a tela', async () => {
    entrarNoMembro.and.resolveTo(vinculadoCompletoNaoVerificado());
    await service.avaliar('/home');
    expect(service.precisaCompletar()).toBe(true);

    // O banco devolve o mesmo membro, agora carimbado.
    pularAtualizacaoCadastral.and.callFake(async () => {
      entrarNoMembro.and.resolveTo(vinculadoCompletoVerificado());
      return { status: 'ok' as const, id: 'm1' };
    });

    const resultado = await service.pularAtualizacao();

    expect(resultado.status).toBe('ok');
    expect(service.precisaCompletar()).toBe(false);
    await expectAsync(service.avaliar('/home')).toBeResolvedTo({ pode: true } as any);
  });

  it('não libera nada quando o pular falha', async () => {
    entrarNoMembro.and.resolveTo(vinculadoCompletoNaoVerificado());
    await service.avaliar('/home');

    pularAtualizacaoCadastral.and.resolveTo({ status: 'erro' });

    const resultado = await service.pularAtualizacao();

    // Segue preso de propósito: se o carimbo não foi gravado, o próximo login
    // perguntaria de novo e a pessoa perderia o que preencheu.
    expect(resultado.status).toBe('erro');
    expect(service.precisaCompletar()).toBe(true);
  });

  it('dispensa quem tem papel de exempted sem consultar o vínculo', async () => {
    getRoles.and.resolveTo(['pastor']);

    const avaliacao = await service.avaliar('/home');

    expect(avaliacao.pode).toBe(true);
    expect(entrarNoMembro).not.toHaveBeenCalled();
  });

  /*
   * Regressão do laço sem saída.
   *
   * O banco devolve `verificado` como timestamptz, que no JSON é TEXTO. Se
   * esse texto passar direto para a comparação com `true`, nunca casa — e a
   * pessoa que conclui o cadastro é devolvida para a mesma tela para sempre,
   * com o carimbo gravado no banco e a tela sem sair. Pior: parece que o
   * botão não funciona.
   *
   * A conversão é responsabilidade da camada de serviço, então o teste entra
   * pelo serviço, com o formato que o banco realmente devolve.
   */
  it('converte o timestamptz do banco em booleanos ao carregar o vínculo', async () => {
    entrarNoMembro.and.resolveTo({
      status: 'vinculado',
      id: 'm1',
      nome: 'Maria Silva',
      completo: true,
      verificado: '2026-09-28T01:30:00+00:00',
    } as any);

    const avaliacao = await service.avaliar('/home');

    expect(avaliacao.pode).toBe(true);
    expect(service.precisaCompletar()).toBe(false);
  });

  it('trata timestamp nulo como "ainda não conferiu"', async () => {
    entrarNoMembro.and.resolveTo({
      status: 'vinculado',
      id: 'm1',
      nome: 'Maria Silva',
      completo: true,
      verificado: null,
    } as any);

    const avaliacao = await service.avaliar('/home');

    expect(avaliacao.pode).toBe(false);
  });
});
