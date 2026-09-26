import { Component, AfterViewInit, OnDestroy, ElementRef, Input, Output, EventEmitter, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tooltip } from 'bootstrap';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterModule } from '@angular/router';
import { SearchbarComponent } from '../searchbar/searchbar.component';
import { CoreService } from '../../../services/core.service';
import { MenuItem, MenuService } from '../../../services/menu.service';
import { SupabaseService } from '../../../services/supabase.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, MatIcon, RouterModule, SearchbarComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnDestroy, OnInit {
  @Input() isDarkMode = false;
  @Output() darkToggle = new EventEmitter<void>();
  @Output() sidenavToggle = new EventEmitter<void>();
  @Input() collapsed = false;

  private tooltips: Tooltip[] = [];
 
  private coreService: CoreService = inject(CoreService);
  private supabaseService: SupabaseService = inject(SupabaseService);
  private menuService: MenuService = inject(MenuService);
 
  fotoUsuario: string = '';
  /** URL que já falhou ao carregar; o Google às vezes responde 429. */
  private fotoQueFalhou = '';
  nomeUsuario: string = "Você";
  roles: string[] = ['membro'];
  termoBusca = '';

  readonly labelsRole: Record<string, string> = {
    administrador: 'Administrador',
    secretaria: 'Secretaria',
    caixa: 'Caixa',
    tesouraria: 'Tesouraria',
    pastor: 'Pastor',
    lider: 'Líder',
    membro: 'Membro',
    leitor: 'Membro'
  };

  get labels(): string[] {
    return this.roles.map((role) => this.labelsRole[role] ?? role);
  }

  get semFoto(): boolean {
    return !this.fotoUsuario || this.fotoQueFalhou === this.fotoUsuario;
  }

  registrarErroFoto(url: string): void {
    this.fotoQueFalhou = url;
  }

  /** Itens do menu que o usuário atual pode ver. */
  get itensVisiveis(): MenuItem[] {
    return this.menuService.disponiveis(this.roles);
  }
  isMobile: boolean;
 
  constructor(private el: ElementRef, private router: Router) {
    this.coreService.isMobile$.subscribe({
      next: (data) => { this.isMobile = data; }
    });
 
    this.coreService.isDarkMode$.subscribe({
      next: (data) => { this.isDarkMode = (data === 'dark'); }
    });
  }
 
  ngOnInit(): void {
    this.carregarUsuario();

    this.coreService.usuario$.subscribe({
      next: (usuario) => {
        this.fotoUsuario = usuario.foto || '';
        this.nomeUsuario = usuario.nome;
        this.roles = usuario.roles;
      }
    });
  }

  private async carregarUsuario(): Promise<void> {
    try {
      const [session, roles] = await Promise.all([
        this.supabaseService.getSession(),
        this.supabaseService.getRoles()
      ]);

      const user = session.data?.session?.user;
      if (!user) return;

      const metadata = user.user_metadata ?? {};
      this.coreService.setUsuario({
        nome: metadata['name'] || metadata['full_name'] || 'Você',
        foto: metadata['avatar_url'] || '',
        roles
      });
    } catch (erro) {
      console.error('Não foi possível obter a sessão:', erro);
    }
  }
 
  ngOnDestroy(): void {
    this.disposeTooltips();
  }

 
  goHome(): void {
    this.router.navigateByUrl('/home');
  }

  /** Escolher um item na busca fecha o menu lateral quando está no mobile. */
  fecharNoMobile(): void {
    this.termoBusca = '';
    if (this.isMobile) {
      this.sidenavToggle.emit();
    }
  }

 
  private disposeTooltips(): void {
    this.tooltips.forEach(tooltip => tooltip.dispose());
    this.tooltips = [];
  }
 
  onDarkToggle(): void {
    this.coreService.toggleDarkMode();
    this.darkToggle.emit();
  }

  onBrandClick(): void {
    if (this.isMobile) {
      this.sidenavToggle.emit();
    }
  }

  onNavClick(event: Event): void {
    const target = event.target as HTMLElement;

    if (this.isMobile && target.closest('a.nav-link')) {
      this.sidenavToggle.emit();
    }
  }


  async logout() {
    await this.supabaseService.signOut();
    this.router.navigate(['/login']);
  }
}