import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { PermissaoService } from '../services/permissao.service';
import { MembroVinculoService } from '../services/membro-vinculo.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  private readonly supabase = inject(SupabaseService);
  private readonly permissao = inject(PermissaoService);
  private readonly vinculo = inject(MembroVinculoService);
  private readonly router = inject(Router);

  /*
   * O tipo é `boolean | UrlTree`, e não `boolean | any`: com `any` no meio, o
   * TypeScript aceita qualquer retorno e o `UrlTree` do fim deixa de ser
   * conferido — que é justamente o retorno que faz o router navegar.
   */
  async canActivate(rota: ActivatedRouteSnapshot, estado: RouterStateSnapshot): Promise<boolean | UrlTree> {
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

    /*
     * Cadastro incompleto é conferido AQUI, e não em cada linha do array de
     * rotas: toda rota protegida já tem AuthGuard, então a checagem não pode
     * ser esquecida na próxima rota que alguém adicionar.
     *
     * A ordem importa. O PermissaoGuard roda depois e manda para /home quem
     * não tem a chave; um membro novo sem cadastro que caísse nele veria um
     * /home mudo em vez da tela que explica o que falta.
     *
     * A decisão mora no serviço, não num CanActivateFn: um guard funcional só
     * tem `inject()` quando é o router que o chama, e um método de classe não
     * é contexto de injeção. Devolver a UrlTree deixa o router navegar.
     */
    const avaliacao = await this.vinculo.avaliar(estado.url);
    if (avaliacao.pode) return true;

    return this.router.createUrlTree(['/completar-cadastro'], {
      queryParams: { origem: estado.url },
    });
  }
}
