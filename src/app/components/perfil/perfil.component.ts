import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterModule],
  templateUrl: './perfil.component.html',
  styleUrl: './perfil.component.scss'
})
export class PerfilComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);

  fotoUsuario = '';
  nomeUsuario = 'Usuário';
  emailUsuario = 'Email não informado';
  role = 'membro';
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
  readonly avatarPadrao = 'casa.png';

  async ngOnInit(): Promise<void> {
    const [{ data: { session } }, role] = await Promise.all([
      this.supabase.getSession(),
      this.supabase.getRole()
    ]);

    if (session) {
      const user = session.user;
      const metadata = user.user_metadata ?? {};
      this.fotoUsuario = metadata['avatar_url'] || this.avatarPadrao;
      this.nomeUsuario =
        metadata['name'] || metadata['full_name'] || user.email?.split('@')[0] || 'Usuário';
      this.emailUsuario = user.email || 'Email não informado';
    }

    this.role = role;
  }
}
