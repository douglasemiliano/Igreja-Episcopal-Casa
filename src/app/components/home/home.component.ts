import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  role: string = 'membro';

  private readonly supabase = inject(SupabaseService);

  async ngOnInit(): Promise<void> {
    this.role = await this.supabase.getRole();
  }

  temPermissao(roles: string[]): boolean {
    return roles.includes(this.role);
  }
}