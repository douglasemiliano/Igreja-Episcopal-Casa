import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MembroVinculoService } from './membro-vinculo.service';
import { SupabaseService } from './supabase.service';
import { nomeExibicao } from '../utils/nome-exibicao';

export interface UsuarioApp {
  nome: string;
  email: string;
  foto: string;
  roles: string[];
}

@Injectable({
  providedIn: 'root'
})
export class CoreService {
  private readonly supabase = inject(SupabaseService);
  private readonly vinculo = inject(MembroVinculoService);

  private isMobileSubject = new BehaviorSubject<boolean>(this.checkScreen());
  isMobile$ = this.isMobileSubject.asObservable();

  private isDarkModeSubject = new BehaviorSubject<string>(this.getStoredTheme());
  isDarkMode$ = this.isDarkModeSubject.asObservable();

  /**
   * Usuário logado compartilhado.
   * Header, sidebar e perfil leem daqui, então uma alteração de nome/foto
   * aparece em todos os lugares sem recarregar a página.
   */
  private usuarioSubject = new BehaviorSubject<UsuarioApp>({
    nome: 'Usuário',
    email: 'Email não informado',
    foto: '',
    roles: ['membro']
  });
  usuario$ = this.usuarioSubject.asObservable();

  /** Evita duas idas ao banco quando header e sidebar montam juntos. */
  private carregandoUsuario: Promise<void> | null = null;

  constructor() {
    this.updateScreen();
    this.applyTheme(this.isDarkModeSubject.value);
    window.addEventListener('resize', () => this.updateScreen());
  }

  get usuarioAtual(): UsuarioApp {
    return this.usuarioSubject.value;
  }

  /** Grava o usuário preservando os campos não informados. */
  setUsuario(parcial: Partial<UsuarioApp>): void {
    this.usuarioSubject.next({ ...this.usuarioSubject.value, ...parcial });
  }

  atualizarFoto(foto: string): void {
    this.setUsuario({ foto });
  }

  /**
   * Recebe o nome completo (o perfil tem o campo inteiro) e guarda o
   * abreviado, porque o valor daqui é sempre rótulo de cabeçalho ou sidebar.
   * Abreviar aqui, e não em quem chama, evita que o próximo componente
   * reintroduza o nome inteiro no cabeçalho.
   */
  atualizarNome(nome: string): void {
    this.setUsuario({ nome: nomeExibicao(nome) || 'Usuário' });
  }

  /**
   * Carrega a identidade do usuário numa fonte só.
   *
   * Header e sidebar fazem isso por conta própria hoje, com o mesmo código
   * copiado nos dois, e ambos leem o nome de `user_metadata` — o que o Google
   * mandou no primeiro login. A partir de quando o perfil passou a ser o
   * cadastro do membro, o nome certo é `membros.nome_completo`, senão o
   * cabeçalho e a lista de membros discordam sobre quem é a pessoa logada.
   *
   * Ordem de precedência do nome: cadastro do membro, depois o que veio do
   * Google, e por último o prefixo do e-mail. Quem não tem linha em `membros`
   * (um administrador que nunca passou pela lista) não fica sem nome por isso.
   *
   * O nome vai já abreviado porque aqui só cabe o rótulo. O nome completo fica
   * no perfil e na ficha do membro, onde há espaço para ele.
   */
  async carregarUsuario(forcar = false): Promise<void> {
    if (!forcar && this.carregandoUsuario) return this.carregandoUsuario;

    this.carregandoUsuario = this.buscarUsuario();
    try {
      await this.carregandoUsuario;
    } finally {
      this.carregandoUsuario = null;
    }
  }

  private async buscarUsuario(): Promise<void> {
    try {
      const [sessao, roles, membro] = await Promise.all([
        this.supabase.getSession(),
        this.supabase.getRoles(),
        this.vinculo.meuMembro()
      ]);

      const user = sessao.data?.session?.user;
      if (!user) return;

      const metadata = user.user_metadata ?? {};
      const nome =
        membro.nome || metadata['name'] || metadata['full_name'] || user.email || '';

      this.setUsuario({
        nome: nomeExibicao(nome) || 'Usuário',
        email: user.email || 'Email não informado',
        // `uploadAvatar` grava a foto nos dois lugares, então a metadata já
        // traz a foto enviada pelo app; `picture` cobre o perfil do Google
        // criado fora do fluxo de avatar.
        foto: metadata['avatar_url'] || metadata['picture'] || '',
        roles
      });
    } catch (erro) {
      console.error('Não foi possível obter a sessão:', erro);
    }
  }

  /*
   * `temAlgumaRole` saiu daqui junto com o RoleGuard: decidir permissão por
   * array de papéis é o que as permissões dinâmicas substituíram, e manter o
   * método disponível seria só um convite a reintroduzir o caminho errado.
   * Quem responde agora é `PermissaoService.pode(chave)`.
   */

  private getStoredTheme(): string {
    return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  }

  private checkScreen(): boolean {
    return window.innerWidth <= 768;
  }

  private updateScreen() {
    this.isMobileSubject.next(this.checkScreen());
  }

  public toggleDarkMode(theme?: string) {
    const next = theme ?? (this.isDarkModeSubject.value === 'dark' ? 'light' : 'dark');
    this.applyTheme(next);
    this.isDarkModeSubject.next(next);
  }

  private applyTheme(theme: string) {
    const body = document.body;
    if (theme === 'dark') {
      body.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      body.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
    }
  }
}