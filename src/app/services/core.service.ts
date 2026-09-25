import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

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

  atualizarNome(nome: string): void {
    this.setUsuario({ nome });
  }

  temAlgumaRole(roles: string[]): boolean {
    if (!roles.length) return true;
    return roles.some((role) => this.usuarioAtual.roles.includes(role));
  }

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