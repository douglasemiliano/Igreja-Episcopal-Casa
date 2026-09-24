import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root'
})
export class CaixaService {
  private supabaseService = inject(SupabaseService)

  async carregarCaixa(): Promise<void> {
    const { data, error } = await this.supabaseService.getCaixaAberto();
    if (error) {
      console.error(error);
      return;
    }
    return data;
  }

}
