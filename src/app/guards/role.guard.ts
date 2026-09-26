import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService, private readonly router: Router) {}

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean> {
    const allowed = route.data['roles'] as string[] | undefined;
    if (!allowed || allowed.length === 0) return true;

    const pode = await this.supabase.temAlgumaRole(allowed);
    if (pode) return true;

    await this.router.navigate(['/home']);
    return false;
  }
}