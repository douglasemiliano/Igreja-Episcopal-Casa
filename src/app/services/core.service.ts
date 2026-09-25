import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CoreService {
  private isMobileSubject = new BehaviorSubject<boolean>(this.checkScreen());
  isMobile$ = this.isMobileSubject.asObservable();

  private isDarkModeSubject = new BehaviorSubject<string>(this.getStoredTheme());
  isDarkMode$ = this.isDarkModeSubject.asObservable();

  constructor() {
    this.updateScreen();
    this.applyTheme(this.isDarkModeSubject.value);
    window.addEventListener('resize', () => this.updateScreen());
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