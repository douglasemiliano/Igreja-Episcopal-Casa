import { CommonModule } from '@angular/common';
import { Component, Renderer2, signal, OnInit, HostListener, inject } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterOutlet } from '@angular/router';
import { environment } from '../environments/environments.development';
import { SupabaseService } from './services/supabase.service';
import { NavbarComponent } from './components/utils/navbar/navbar.component';
import { LoadingComponent } from './components/utils/loading/loading.component';
import { SidebarComponent } from './components/utils/sidebar/sidebar.component';
import { CoreService } from './services/core.service';
import { CaixaService } from './services/caixa.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterOutlet, MatCardModule, MatIconModule, NavbarComponent, LoadingComponent, SidebarComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  protected readonly title = signal('episcopalcasa');
  dataUnica: Date = new Date();
  isDarkMode = false;
  isLoggedIn: boolean;
  isExpanded = true;

  private coreService = inject(CoreService);


  constructor(private router: Router, private renderer: Renderer2, private supabase: SupabaseService, private caixaService: CaixaService){
    this.checkScreenSize();
  }

  async ngOnInit() {
    // restaura tema salvo (opcional)
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') {
      this.isDarkMode = true;
      this.renderer.addClass(document.body, 'dark-mode');
    }

    const { data } = await this.supabase.getSession();
    this.isLoggedIn = !!data?.session;

    this.supabase.onAuthChange((_event, session) => {
      this.isLoggedIn = !!session;
    });

    this.caixaService.carregarCaixa();
  }

  mudouData() { this.router.navigateByUrl("/lecionario") }
  goToHome() { this.router.navigateByUrl("/home") }

  toggleDarkMode() {
    console.log('Trocando tema', );
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
    console.log('Trocando sidebar', );
    this.isExpanded = !this.isExpanded;
  }

  @HostListener('window:resize')
  onResize() {
    this.checkScreenSize();
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
