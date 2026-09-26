import { TestBed } from '@angular/core/testing';

import { MenuService } from './menu.service';

describe('MenuService', () => {
  let service: MenuService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MenuService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('esconde itens restritos de quem não tem o perfil', () => {
    const caminhos = service.disponiveis(['membro']).map((item) => item.path);

    expect(caminhos).toContain('/home');
    expect(caminhos).not.toContain('/dashboard');
    expect(caminhos).not.toContain('/central');
  });

  it('libera o item restrito para quem tem o perfil', () => {
    const caminhos = service.disponiveis(['pastor']).map((item) => item.path);

    expect(caminhos).toContain('/dashboard');
    expect(caminhos).toContain('/central');
  });

  it('ignora acento na busca', () => {
    const resultados = service.buscar(['secretaria'], 'relatorio');

    expect(resultados.map((item) => item.label)).toEqual(['Relatórios de Caixas']);
  });

  it('não revela item restrito na busca', () => {
    expect(service.buscar(['membro'], 'relatorio')).toEqual([]);
    expect(service.buscar(['membro'], 'dashboard')).toEqual([]);
  });

  it('devolve o menu inteiro quando o termo é vazio', () => {
    expect(service.buscar(['administrador'], '  ')).toEqual(service.disponiveis(['administrador']));
  });
});
