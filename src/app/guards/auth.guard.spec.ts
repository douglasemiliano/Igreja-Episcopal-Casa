import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { SupabaseService } from '../services/supabase.service';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let getUser: jasmine.Spy;
  let navigate: jasmine.Spy;

  beforeEach(() => {
    getUser = jasmine.createSpy('getUser').and.resolveTo({ id: 'u1' });
    navigate = jasmine.createSpy('navigate');

    TestBed.configureTestingModule({
      providers: [
        AuthGuard,
        { provide: SupabaseService, useValue: { getUser } },
        { provide: Router, useValue: { navigate } }
      ]
    });
    guard = TestBed.inject(AuthGuard);
  });

  it('libera a rota quando tem usuário', async () => {
    await expectAsync(guard.canActivate()).toBeResolvedTo(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('manda para o login quando não tem usuário', async () => {
    getUser.and.resolveTo(null);

    await expectAsync(guard.canActivate()).toBeResolvedTo(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
