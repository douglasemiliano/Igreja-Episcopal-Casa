import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterModule } from '@angular/router';
import { CoreService } from '../../../services/core.service';
import { LecionarioService } from '../../../services/lecionario.service';
import { SupabaseService } from '../../../services/supabase.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  @Input() isDarkMode = false;
  @Output() darkToggle = new EventEmitter<void>();
  @Output() sidenavToggle = new EventEmitter<void>();
  @Input() isExpanded = true;
  @Input() collapsed = false;
  @Output() toggleSidebar = new EventEmitter<void>();

  appsMenuOpen = false;
  readonly avatarPadrao = 'casa.png';
  fotoUsuario = this.avatarPadrao;
  nomeUsuario = 'Usuário';
  roles: string[] = ['membro'];
  isUserMenuOpen = false;
  emailUsuario = 'Email não informado';
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

  /** Rótulos das roles do usuário, ex.: "Tesouraria · Líder". */
  get roleLabel(): string {
    return this.roles.map((role) => this.labelsRole[role] ?? role).join(' · ') || 'Membro';
  }

  constructor(
    private router: Router,
    private supabase: SupabaseService,
    private lecionarioService: LecionarioService,
    private coreService: CoreService
  ) {}

  ngOnInit(): void {
    this.carregarUsuario();

    // Fonte única de verdade: qualquer tela que alterar nome/foto
    // reflete aqui sem recarregar a página.
    this.coreService.usuario$.subscribe({
      next: (usuario) => {
        this.fotoUsuario = usuario.foto || this.avatarPadrao;
        this.nomeUsuario = usuario.nome;
        this.emailUsuario = usuario.email;
        this.roles = usuario.roles;
      }
    });

    this.coreService.isDarkMode$.subscribe({
      next: (data) => {
        this.isDarkMode = data === 'dark';
      }
    });
  }

  private async carregarUsuario(): Promise<void> {
    try {
      const [session, roles] = await Promise.all([
        this.supabase.getSession(),
        this.supabase.getRoles()
      ]);

      const user = session.data?.session?.user;
      if (!user) return;

      const metadata = user.user_metadata ?? {};
      this.coreService.setUsuario({
        nome:
          metadata['name'] || metadata['full_name'] || user.email?.split('@')[0] || 'Usuário',
        email: user.email || 'Email não informado',
        foto: metadata['avatar_url'] || this.avatarPadrao,
        roles
      });
    } catch (erro) {
      console.error('Não foi possível obter a sessão:', erro);
    }
  }

  onToggleSidebar(): void {
    this.toggleSidebar.emit();
  }

  toggleUserMenu(event: Event): void {
    event.stopPropagation();
    this.isUserMenuOpen = !this.isUserMenuOpen;
  }

  @HostListener('document:click')
  closeUserMenu(): void {
    this.isUserMenuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.isUserMenuOpen = false;
  }

  onDarkToggle(): void {
    this.coreService.toggleDarkMode();
    this.darkToggle.emit();
  }

  async logout(): Promise<void> {
    this.closeUserMenu();
    await this.supabase.signOut();
    await this.router.navigate(['/login']);
  }

  goToPerfil(): void {
    this.closeUserMenu();
    this.router.navigate(['/perfil']);
  }

  goToCadastro(): void {
    this.lecionarioService.setLecionarioSelecionado(null);
    this.router.navigateByUrl('/cadastro');
  }

  onSidenavToggle(): void {
    this.isExpanded = !this.isExpanded;
    this.sidenavToggle.emit();
  }

  toggleAppsMenu(): void {
    this.appsMenuOpen = !this.appsMenuOpen;
  }
}
