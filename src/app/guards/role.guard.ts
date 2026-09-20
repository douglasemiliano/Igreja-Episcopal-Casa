import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService, private readonly router: Router) {}

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean> {
    const role = await this.supabase.getRole();
    const allowed = route.data['roles'] as string[] | undefined;
    if (!allowed || allowed.includes(role)) return true;
    await this.router.navigate(['/home']);
    return false;
  }
}