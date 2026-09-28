import { TestBed } from '@angular/core/testing';

import { MenuService } from './menu.service';

/**
 * `disponiveis` e `buscar` recebem um PREDICADO, não uma lista de papéis.
 *
 * Quem tem cada capacidade é decidido na tabela `permissoes_roles` do banco,
 * então o menu não pode olhar para o array de roles: passá-lo faria o menu
 * divergir da tela /permissoes, que é a fonte da verdade. Os testes abaixo
 * traduzem papel em predicado para ainda descreverem a situação, mas o que o
 * serviço recebe é sempre "esta chave, pode?".
 */
const comChave = (...chaves: string[]) => (chave: string) => chaves.includes(chave);

describe('MenuService', () => {
  let service: MenuService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MenuService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('esconde itens restritos de quem não tem a capacidade', () => {
    const caminhos = service.disponiveis(comChave()).map((item) => item.path);

    expect(caminhos).toContain('/home');
    expect(caminhos).not.toContain('/dashboard');
    expect(caminhos).not.toContain('/central');
  });

  it('libera o item restrito para quem tem a capacidade', () => {
    const caminhos = service
      .disponiveis(comChave('ver_dashboard', 'ver_central'))
      .map((item) => item.path);

    expect(caminhos).toContain('/dashboard');
    expect(caminhos).toContain('/central');
  });

  it('ignora acento na busca', () => {
    const resultados = service.buscar(comChave('ver_relatorios_caixa'), 'relatorio');

    expect(resultados.map((item) => item.label)).toEqual(['Histórico e Relatórios']);
  });

  it('não revela item restrito na busca', () => {
    expect(service.buscar(comChave(), 'relatorio')).toEqual([]);
    expect(service.buscar(comChave(), 'dashboard')).toEqual([]);
  });

  it('devolve o menu inteiro quando o termo é vazio', () => {
    const pode = comChave('ver_dashboard', 'ver_relatorios_caixa');
    expect(service.buscar(pode, '  ')).toEqual(service.disponiveis(pode));
  });
});
