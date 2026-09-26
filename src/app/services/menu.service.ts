import { Injectable } from '@angular/core';

export interface MenuItem {
  path: string;
  label: string;
  icon: string;
  /** Perfis liberados. Vazio = qualquer usuário autenticado. */
  roles: string[];
}

/**
 * Fonte única de verdade do menu.
 *
 * O sidebar desenha os itens a partir daqui e o searchbar usa a mesma
 * lista para buscar — assim um item novo (ou uma permissão nova) aparece
 * nos dois lugares sem risco de divergirem.
 */
@Injectable({
  providedIn: 'root'
})
export class MenuService {
  readonly itens: MenuItem[] = [
    { path: '/home', label: 'Inicio', icon: 'newspaper', roles: [] },
    {
      path: '/central',
      label: 'Central',
      icon: 'apps',
      roles: ['administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor', 'lider']
    },
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: 'dashboard',
      roles: ['administrador', 'pastor', 'secretaria', 'tesouraria']
    },
    { path: '/membros', label: 'Membros', icon: 'groups', roles: [] },
    { path: '/agenda', label: 'Agenda', icon: 'calendar_month', roles: [] },
    {
      path: '/acoes',
      label: 'Caixa',
      icon: 'payments',
      roles: ['administrador', 'caixa', 'tesouraria', 'pastor']
    },
    {
      path: '/relatorios-caixas',
      label: 'Relatórios de Caixas',
      icon: 'bar_chart',
      roles: ['administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor']
    },
    {
      path: '/certificado',
      label: 'Certificados',
      icon: 'workspace_premium',
      roles: ['administrador', 'secretaria', 'pastor']
    },
    { path: '/lecionario', label: 'Lecionário', icon: 'menu_book', roles: [] },
    {
      path: '/lecionario/listar',
      label: 'Gerenciar lecionários',
      icon: 'bookmarks',
      roles: ['administrador', 'secretaria', 'pastor']
    },
    {
      path: '/livro',
      label: 'Livros de Registro',
      icon: 'auto_stories',
      roles: ['administrador', 'secretaria', 'pastor']
    },
    {
      path: '/usuarios',
      label: 'Usuários',
      icon: 'manage_accounts',
      roles: ['administrador', 'pastor']
    }
  ];

  /** Itens que o usuário pode ver, na ordem do menu. */
  disponiveis(roles: string[] | null | undefined): MenuItem[] {
    const perfis = roles ?? [];
    return this.itens.filter(
      (item) => !item.roles.length || item.roles.some((role) => perfis.includes(role))
    );
  }

  /**
   * Busca no menu respeitando os perfis do usuário.
   * Sem termo, devolve o menu completo; sem permissão, não devolve nada.
   */
  buscar(roles: string[] | null | undefined, termo: string): MenuItem[] {
    const permitidos = this.disponiveis(roles);
    const busca = this.normalizar(termo ?? '');
    if (!busca) return permitidos;

    return permitidos.filter((item) => this.normalizar(item.label).includes(busca));
  }

  /** Minúsculas sem acento, para "relatorio" achar "Relatórios". */
  private normalizar(texto: string): string {
    return texto
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
