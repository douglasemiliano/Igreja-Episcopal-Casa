import { Component, AfterViewInit, OnDestroy, ElementRef, Input, Output, EventEmitter, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tooltip } from 'bootstrap';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterModule } from '@angular/router';
import { CoreService } from '../../../services/core.service';
import { SupabaseService } from '../../../services/supabase.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, MatIcon, RouterModule],
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
 
  fotoUsuario: string;
  nomeUsuario: string = "Você";
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
    this.supabaseService.getSession().then(({ data: { session } }) => {
      if (session) {
        this.fotoUsuario = session.user.user_metadata['avatar_url'];
        this.nomeUsuario = session.user.user_metadata['name']
      }
    });

    this.supabaseService.getRole().then((role) => {
      this.role = role;
    });
  }
 
  ngOnDestroy(): void {
    this.disposeTooltips();
  }

 
  goHome(): void {
    this.router.navigateByUrl('/home');
  }

  temPermissao(roles: string[] | null): boolean {
    if (!roles || roles.length === 0) return true;
    return roles.includes(this.role);
  }

 
  private disposeTooltips(): void {
    this.tooltips.forEach(tooltip => tooltip.dispose());
    this.tooltips = [];
  }
 
  onDarkToggle() {
    this.coreService.toggleDarkMode();
    this.darkToggle.emit();
  }

onNavClick(event: Event): void {
  const target = event.target as HTMLElement;

  if (
    this.isMobile &&
    target.closest('a.nav-link')
  ) {
    this.sidenavToggle.emit();
  }
}

  async logout() {
    await this.supabaseService.signOut();
    this.router.navigate(['/login']);
  }
}