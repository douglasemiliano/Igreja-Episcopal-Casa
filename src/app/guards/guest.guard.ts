import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Injectable({
  providedIn: 'root'
})
export class GuestGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly router: Router
  ) {}

  async canActivate(): Promise<boolean> {
    const user = await this.supabase.getUser();

    if (user) {
      await this.router.navigate(['/home']);
      return false;
    }

    return true;
  }
}
