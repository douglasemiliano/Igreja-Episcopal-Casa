import { Injectable } from '@angular/core';

export interface MenuItem {
  path: string;
  label: string;
  icon: string;
  /** Perfis liberados. Vazio = qualquer usuário autenticado. */
  roles: string[];
  /**
   * Cabeçalho de categoria no sidebar. A ordem dos grupos é a ordem em que
   * eles aparecem aqui em `GRUPOS`, não a ordem dos itens.
   */
  grupo: string;
}

export interface GrupoMenu {
  titulo: string;
  itens: MenuItem[];
}

/**
 * Ordem dos cabeçalhos do sidebar.
 *
 * Fica separada dos itens de propósito: o menu é lido de cima para baixo e a
 * ordem das categorias é decisão de leitura, não de código. Um grupo sem item
 * visível para o perfil atual simplesmente não é desenhado.
 */
export const GRUPOS: string[] = ['Igreja', 'Caixa', 'Comunidade', 'Registros', 'Administração'];

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
    { path: '/home', label: 'Inicio', icon: 'newspaper', roles: [], grupo: 'Igreja' },
    {
      path: '/central',
      label: 'Central',
      icon: 'apps',
      roles: ['administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor', 'lider'],
      grupo: 'Igreja'
    },
    { path: '/agenda', label: 'Agenda', icon: 'calendar_month', roles: [], grupo: 'Igreja' },
    {
      path: '/acoes',
      label: 'Caixa',
      icon: 'payments',
      roles: ['administrador', 'caixa', 'tesouraria', 'pastor'],
      grupo: 'Caixa'
    },
    {
      path: '/relatorios-caixas',
      label: 'Histórico e Relatórios',
      icon: 'bar_chart',
      roles: ['administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor'],
      grupo: 'Caixa'
    },
    {
      path: '/membros',
      label: 'Membros',
      icon: 'groups',
      roles: [],
      grupo: 'Comunidade'
    },
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: 'dashboard',
      roles: ['administrador', 'pastor', 'secretaria', 'tesouraria'],
      grupo: 'Comunidade'
    },
    {
      path: '/certificado',
      label: 'Certificados',
      icon: 'workspace_premium',
      roles: ['administrador', 'secretaria', 'pastor'],
      grupo: 'Registros'
    },
    {
      path: '/livro',
      label: 'Livros de Registro',
      icon: 'auto_stories',
      roles: ['administrador', 'secretaria', 'pastor'],
      grupo: 'Registros'
    },
    { path: '/lecionario', label: 'Lecionário', icon: 'menu_book', roles: [], grupo: 'Registros' },
    {
      path: '/lecionario/listar',
      label: 'Gerenciar lecionários',
      icon: 'bookmarks',
      roles: ['administrador', 'secretaria', 'pastor'],
      grupo: 'Registros'
    },
    {
      path: '/usuarios',
      label: 'Usuários',
      icon: 'manage_accounts',
      roles: ['administrador', 'pastor'],
      grupo: 'Administração'
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
   * Mesmo menu do `disponiveis`, porém agrupado para o sidebar desenhar os
   * cabeçalhos. Um item sem grupo conhecido vai para "Outros", para nunca
   * sumir do menu por um erro de digitação aqui no serviço.
   */
  grupos(roles: string[] | null | undefined): GrupoMenu[] {
    const permitidos = this.disponiveis(roles);
    const montados: GrupoMenu[] = [];

    for (const titulo of GRUPOS) {
      const itens = permitidos.filter((item) => item.grupo === titulo);
      if (itens.length) {
        montados.push({ titulo, itens });
      }
    }

    const soltos = permitidos.filter((item) => !GRUPOS.includes(item.grupo));
    if (soltos.length) {
      montados.push({ titulo: 'Outros', itens: soltos });
    }

    return montados;
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
