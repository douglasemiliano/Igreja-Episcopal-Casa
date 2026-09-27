import { Injectable } from '@angular/core';

export interface MenuItem {
  path: string;
  label: string;
  icon: string;
  /**
   * Capacidade que abre este item, e nada mais. Vazio = qualquer usuário
   * autenticado. A chave aponta para uma linha de `public.permissoes`, então
   * quem enxerga o item é decidido em /permissoes, e não aqui.
   */
  chave: string;
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
    { path: '/home', label: 'Inicio', icon: 'newspaper', chave: '', grupo: 'Igreja' },
    { path: '/central', label: 'Central', icon: 'apps', chave: 'ver_central', grupo: 'Igreja' },
    { path: '/agenda', label: 'Agenda', icon: 'calendar_month', chave: '', grupo: 'Igreja' },
    { path: '/acoes', label: 'Caixa', icon: 'payments', chave: 'operar_arrecadacoes', grupo: 'Caixa' },
    {
      path: '/relatorios-caixas',
      label: 'Histórico e Relatórios',
      icon: 'bar_chart',
      chave: 'ver_relatorios_caixa',
      grupo: 'Caixa'
    },
    { path: '/membros', label: 'Membros', icon: 'groups', chave: '', grupo: 'Comunidade' },
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', chave: 'ver_dashboard', grupo: 'Comunidade' },
    {
      path: '/certificado',
      label: 'Certificados',
      icon: 'workspace_premium',
      chave: 'emitir_certificado',
      grupo: 'Registros'
    },
    {
      path: '/livro',
      label: 'Livros de Registro',
      icon: 'auto_stories',
      chave: 'ver_livro_registro',
      grupo: 'Registros'
    },
    { path: '/lecionario', label: 'Lecionário', icon: 'menu_book', chave: '', grupo: 'Registros' },
    {
      path: '/lecionario/listar',
      label: 'Gerenciar lecionários',
      icon: 'bookmarks',
      chave: 'gerenciar_lecionario',
      grupo: 'Registros'
    },
    {
      path: '/usuarios',
      label: 'Usuários',
      icon: 'manage_accounts',
      chave: 'gerenciar_usuarios',
      grupo: 'Administração'
    },
    {
      path: '/permissoes',
      label: 'Permissões',
      icon: 'admin_panel_settings',
      chave: 'gerenciar_permissoes',
      grupo: 'Administração'
    }
  ];

  /** Itens que o usuário pode ver, na ordem do menu. */
  disponiveis(pode: (chave: string) => boolean): MenuItem[] {
    return this.itens.filter((item) => !item.chave || pode(item.chave));
  }

  /**
   * Mesmo menu do `disponiveis`, porém agrupado para o sidebar desenhar os
   * cabeçalhos. Um item sem grupo conhecido vai para "Outros", para nunca
   * sumir do menu por um erro de digitação aqui no serviço.
   */
  grupos(pode: (chave: string) => boolean): GrupoMenu[] {
    const permitidos = this.disponiveis(pode);
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
   * Busca no menu respeitando as capacidades do usuário.
   * Sem termo, devolve o menu completo; sem permissão, não devolve nada.
   */
  buscar(pode: (chave: string) => boolean, termo: string): MenuItem[] {
    const permitidos = this.disponiveis(pode);
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
