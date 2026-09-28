import { CommonModule } from '@angular/common';
import { Component, HostListener, inject, OnInit, Renderer2, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { LoadingComponent } from './components/utils/loading/loading.component';
import { NavbarComponent } from './components/utils/navbar/navbar.component';
import { ToastContainerComponent } from './components/utils/toast/toast.component';
import { CaixaService } from './services/caixa.service';
import { CoreService } from './services/core.service';
import { PermissaoService } from './services/permissao.service';
import { SupabaseService } from './services/supabase.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatIconModule, LoadingComponent, NavbarComponent, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  protected readonly title = signal('episcopalcasa');
  dataUnica: Date = new Date();
  isDarkMode = false;
  isLoggedIn: boolean = false;
  isExpanded = true;

  private coreService = inject(CoreService);
  private readonly permissao = inject(PermissaoService);
  private readonly caixaService = inject(CaixaService);


  constructor(private router: Router, private renderer: Renderer2, private supabase: SupabaseService){
    this.checkScreenSize();
  }

  async ngOnInit() {
    // restaura tema salvo (opcional)
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') {
      this.isDarkMode = true;
      this.renderer.addClass(document.body, 'dark-mode');
    }

    /*
     * A leitura da sessão pode falhar (ex.: NavigatorLockAcquireTimeoutError
     * do Supabase quando outra aba segura o lock de auth). Isso não pode
     * derrubar o app: em caso de erro seguimos sem sessão e o AuthGuard
     * redireciona para o login normalmente.
     */
    try {
      const { data, error } = await this.supabase.getUserResult();

      if (error) {
        await this.supabase.signOut().catch(() => undefined);
        this.isLoggedIn = false;
      } else {
        this.isLoggedIn = !!data?.user;
      }
    } catch (erro) {
      console.error('Não foi possível restaurar a sessão:', erro);
      this.isLoggedIn = false;
    }

    this.supabase.onAuthChange((_event, session) => {
      this.isLoggedIn = !!session;

      if (session) {
        /*
         * Login vindo de outra aba: o conjunto do usuário anterior não vale,
         * e `limpar()` já zerou o cache no logout. Não precisa de `forcar`
         * aqui — forçar aqui punia o INITIAL_SESSION, que o SDK dispara em
         * todo recarregamento de página e ia custar uma consulta a mais.
         */
        void this.permissao.carregar();
      } else {
        // Nada aqui sobrevive para a próxima conta que logar nesta aba.
        this.permissao.limpar();
        this.coreService.limpar();
        this.caixaService.limpar();
      }
    });
  }

  mudouData() { this.router.navigateByUrl("/lecionario") }
  goToHome() { this.router.navigateByUrl("/home") }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    
    const themeClass = 'dark-mode';
    const body = document.body;
    
    if (this.isDarkMode) {
      this.renderer.addClass(body, themeClass);
      localStorage.setItem('theme', 'dark');
      this.coreService.toggleDarkMode('dark');
    } else {
      this.renderer.removeClass(body, themeClass);
      localStorage.setItem('theme', 'light');
      this.coreService.toggleDarkMode('light');
    }
  }

  toggleSidenav() {
    this.isExpanded = !this.isExpanded;
  }

  @HostListener('window:resize')
  onResize() {
    this.checkScreenSize();
  }

  /**
   * O administrador pode mudar as permissões de quem está com a aba aberta,
   * e a pessoa só descobre quando a tela esconde algum botão. Voltar para a
   * aba é a hora barata de conferir, e o próprio serviço segura o throttle.
   */
  @HostListener('document:visibilitychange')
  onVisibilidade() {
    void this.permissao.aoVoltarParaAba();
  }

    private checkScreenSize() {
    if (window.innerWidth <= 768) {
      this.isExpanded = false; // começa colapsado no mobile
    } else {
      this.isExpanded = true; // expandido no desktop
    }
  }

    closeSidebar(event: Event) {
    // Fecha o sidebar se ele estiver aberto e o clique não for nele
    if  (window.innerWidth <= 768) {
      if (this.isExpanded) {
        this.isExpanded = false;
      }
    }

  }
}
