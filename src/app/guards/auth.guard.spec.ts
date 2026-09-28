import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';

import { SupabaseService } from '../services/supabase.service';
import { PermissaoService } from '../services/permissao.service';
import { MembroVinculoService } from '../services/membro-vinculo.service';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let getUser: jasmine.Spy;
  let navigate: jasmine.Spy;
  let createUrlTree: jasmine.Spy;
  let avaliar: jasmine.Spy;
  let carregarPermissoes: jasmine.Spy;

  const rota = {} as any;
  const estado = { url: '/home' } as any;

  beforeEach(() => {
    getUser = jasmine.createSpy('getUser').and.resolveTo({ id: 'u1' });
    navigate = jasmine.createSpy('navigate');
    createUrlTree = jasmine.createSpy('createUrlTree').and.returnValue('URLTREE' as any);
    avaliar = jasmine.createSpy('avaliar').and.resolveTo({ pode: true });
    carregarPermissoes = jasmine.createSpy('carregar').and.resolveTo(undefined);

    TestBed.configureTestingModule({
      providers: [
        AuthGuard,
        { provide: SupabaseService, useValue: { getUser } },
        { provide: PermissaoService, useValue: { carregar: carregarPermissoes } },
        { provide: MembroVinculoService, useValue: { avaliar } },
        { provide: Router, useValue: { navigate, createUrlTree } },
      ],
    });
    guard = TestBed.inject(AuthGuard);
  });

  it('libera a rota quando tem usuário', async () => {
    await expectAsync(guard.canActivate(rota, estado)).toBeResolvedTo(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('manda para o login quando não tem usuário', async () => {
    getUser.and.resolveTo(null);

    await expectAsync(guard.canActivate(rota, estado)).toBeResolvedTo(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('carrega as permissões antes de decidir', async () => {
    await guard.canActivate(rota, estado);
    expect(carregarPermissoes).toHaveBeenCalled();
  });

  it('devolve a UrlTree quando o cadastro está incompleto', async () => {
    avaliar.and.resolveTo({ pode: false, motivo: 'pre_cadastro' });

    const resultado = await guard.canActivate(rota, estado);

    // A UrlTree é devolvida, não navegada: quem navega é o router, e assim a
    // origem volta no query param para a tela poder devolver a pessoa ao
    // lugar de onde ela veio.
    expect(resultado as unknown as UrlTree).toBe('URLTREE' as any);
    expect(createUrlTree).toHaveBeenCalledWith(['/completar-cadastro'], {
      queryParams: { origem: '/home' },
    });
  });

  it('não consulta o cadastro quando não tem usuário', async () => {
    getUser.and.resolveTo(null);

    await guard.canActivate(rota, estado);

    expect(avaliar).not.toHaveBeenCalled();
  });
});
