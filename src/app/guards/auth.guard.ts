import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { PermissaoService } from '../services/permissao.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  private readonly supabase = inject(SupabaseService);
  private readonly permissao = inject(PermissaoService);
  private readonly router = inject(Router);

  async canActivate(): Promise<boolean> {
    const user = await this.supabase.getUser();
    if (!user) {
      await this.router.navigate(['/login']);
      return false;
    }

    /*
     * Toda rota autenticada passa por aqui, então é o único lugar do
     * front-end em que não dá para o conjunto de capacidades chegar vazio
     * por descuido. O PermissaoGuard e os `@if` das telas dependem disso.
     */
    await this.permissao.carregar();

    return true;
  }
}
