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
  role = 'membro';
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

  constructor(
    private router: Router,
    private supabase: SupabaseService,
    private lecionarioService: LecionarioService,
    private coreService: CoreService
  ) {}

  ngOnInit(): void {
    this.supabase
      .getSession()
      .then(({ data }) => {
        const session = data?.session;
        if (!session) return;
        const user = session.user;
        const metadata = user.user_metadata ?? {};
        this.fotoUsuario = metadata['avatar_url'] || this.avatarPadrao;
        this.nomeUsuario =
          metadata['name'] || metadata['full_name'] || user.email?.split('@')[0] || 'Usuário';
        this.emailUsuario = user.email || 'Email não informado';
      })
      .catch((erro) => console.error('Não foi possível obter a sessão:', erro));

    this.supabase
      .getRole()
      .then((role) => {
        this.role = role;
      })
      .catch(() => undefined);

    this.coreService.isDarkMode$.subscribe({
      next: (data) => {
        this.isDarkMode = data === 'dark';
      }
    });
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
