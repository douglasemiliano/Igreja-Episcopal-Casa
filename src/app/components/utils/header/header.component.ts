import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { Router, RouterModule } from "@angular/router";
import { MatIconModule } from "@angular/material/icon";
import { SupabaseService } from "../../../services/supabase.service";
import { LecionarioService } from "../../../services/lecionario.service";
import { CoreService } from '../../../services/core.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatIconModule
  ],
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

  onToggleSidebar(): void {
    this.toggleSidebar.emit();
  }

  appsMenuOpen = false;
  fotoUsuario: string;
  nomeUsuario: string = 'Usuário';
  role: string = 'leitor';
  readonly labelsRole: Record<string, string> = {
    administrador: 'Administrador',
    secretaria: 'Secretaria',
    caixa: 'Caixa',
    tesouraria: 'Tesouraria',
    pastor: 'Pastor',
    leitor: 'Leitor'
  };
  avatarPadrao: string = 'https://imgs.search.brave.com/CFBTYPNRel95sDw00APELv5D4Ghs73sYYcN0-tLpV5U/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tYXJr/ZXRwbGFjZS5jYW52/YS5jb20vZ0pseTAv/TUFHRGtNZ0pseTAv/MS90bC9jYW52YS11/c2VyLXByb2ZpbGUt/aWNvbi12ZWN0b3Iu/LWF2YXRhci1vci1w/ZXJzb24taWNvbi4t/cHJvZmlsZS1waWN0/dXJlLC1wb3J0cmFp/dC1zeW1ib2wuLU1B/R0RrTWdKbHkwLnBu/Zw';

  constructor(
    private router: Router,
    private supabase: SupabaseService,
    private lecionarioService: LecionarioService,
    private coreService: CoreService
  ) {}

 ngOnInit(): void {
    this.supabase.getSession().then(({ data: { session } }) => {
      if (session) {
        this.fotoUsuario = session.user.user_metadata['avatar_url'];
        this.nomeUsuario = session.user.user_metadata['name'] ?? 'Você';
      }
    });

    this.supabase.getRole().then((role) => {
      this.role = role;
    });

        this.coreService.isDarkMode$.subscribe({
      next: (data) => { this.isDarkMode = (data === 'dark'); }
    });
  }


  onDarkToggle() {
    this.coreService.toggleDarkMode();
    this.darkToggle.emit();
  }

  async logout() {
    await this.supabase.signOut();
    this.router.navigate(['/login']);
  }

  goToPerfil() {
    this.router.navigate(['/perfil']); // 👈 rota do perfil
  }

  goToCadastro() {
    this.lecionarioService.setLecionarioSelecionado(null);
    this.router.navigateByUrl('/cadastro');
  }

  onSidenavToggle() {
    this.isExpanded = !this.isExpanded;
    this.sidenavToggle.emit();
  }

    toggleAppsMenu(): void {
    this.appsMenuOpen = !this.appsMenuOpen;
  }
}
