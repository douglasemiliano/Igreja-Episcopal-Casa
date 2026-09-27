import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router } from '@angular/router';
import { PermissaoService } from '../services/permissao.service';

/**
 * Guarda as rotas por capacidade, e não mais por lista de papéis.
 *
 * A rota declara `data: { chave: 'ver_dashboard' }` e o guard pergunta ao
 * PermissaoService, que por baixo consulta public.pode() no banco. Trocar o
 * dono de uma tela deixa de ser mexer em código: é a tela /permissoes.
 *
 * `data.chave` ausente = rota sem restrição, como antes.
 */
@Injectable({ providedIn: 'root' })
export class PermissaoGuard implements CanActivate {
  private readonly permissao = inject(PermissaoService);
  private readonly router = inject(Router);

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean> {
    const chave = route.data['chave'] as string | undefined;
    if (!chave) return true;

    // Abarca o caso de alguém colar a URL direto: o guard é chamado antes do
    // componente existir, então o conjunto pode ainda não ter sido buscado.
    await this.permissao.carregar();

    if (this.permissao.pode(chave)) return true;

    await this.router.navigate(['/home']);
    return false;
  }
}
