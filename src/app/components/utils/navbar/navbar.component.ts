import { Component, inject, OnDestroy } from '@angular/core';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { RouterOutlet } from '@angular/router';
import { CoreService } from '../../../services/core.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-navbar',
  imports: [HeaderComponent, SidebarComponent, RouterOutlet],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent implements OnDestroy {

  sidebarCollapsed = window.innerWidth <= 768;
  isMobile = window.innerWidth <= 768;

  private coreService = inject(CoreService);
  private mobileSub: Subscription;

  constructor() {
    this.mobileSub = this.coreService.isMobile$.subscribe({
      next: (isMobile) => {
        this.isMobile = isMobile;
        if (isMobile) {
          this.sidebarCollapsed = true;
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.mobileSub?.unsubscribe();
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  closeSidebar(): void {
    if (this.isMobile) {
      this.sidebarCollapsed = true;
    }
  }

}