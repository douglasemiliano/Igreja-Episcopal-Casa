import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { SupabaseService } from '../../../services/supabase.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-gerenciar-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './gerenciar-usuarios.component.html',
  styleUrl: './gerenciar-usuarios.component.scss'
})
export class GerenciarUsuariosComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  readonly roles = ['administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor', 'lider', 'membro'];
  readonly labels: Record<string, string> = {
    administrador: 'Administrador',
    secretaria: 'Secretaria',
    caixa: 'Caixa',
    tesouraria: 'Tesouraria',
    pastor: 'Pastor',
    lider: 'Líder',
    membro: 'Membro',
    leitor: 'Membro'
  };

  usuarios: any[] = [];
  carregando = true;
  salvandoId: string | null = null;
  erro = '';
  usuarioAtualId: string | null = null;
  roleAtual: string = '';

  async ngOnInit(): Promise<void> {
    const { data } = await this.supabase.getUserResult();
    this.usuarioAtualId = data.user?.id ?? null;
    this.roleAtual = await this.supabase.getRole();
    await this.listar();
  }

  ehUsuarioAtual(id: string): boolean {
    return this.usuarioAtualId === id;
  }

  ehAdministrador(): boolean {
    return this.roleAtual === 'administrador';
  }

  // Pastores não alteram o perfil próprio nem de administradores.
  podeGerenciar(usuario: any): boolean {
    if (this.ehUsuarioAtual(usuario.id)) return false;
    if (this.ehAdministrador()) return true;
    return usuario.role !== 'administrador';
  }

  // Somente administradores podem conceder/alterar o perfil de administrador.
  perfisDisponiveis(): string[] {
    return this.ehAdministrador()
      ? this.roles
      : this.roles.filter((role) => role !== 'administrador');
  }

  async listar(): Promise<void> {
    this.carregando = true;
    const { data, error } = await this.supabase.listUsuarios();
    if (error) {
      this.erro = 'Não foi possível carregar os usuários.';
      console.error(error);
    } else {
      this.usuarios = data ?? [];
    }
    this.carregando = false;
  }

  async mudarRole(usuario: any): Promise<void> {
    if (!this.podeGerenciar(usuario)) return;
    this.salvandoId = usuario.id;
    const { error } = await this.supabase.atualizarRoleUsuario(usuario.id, usuario.role);
    this.salvandoId = null;
    if (error) {
      console.error(error);
      this.toast.erro('Erro ao salvar o perfil do usuário');
      return;
    }
    this.toast.sucesso(`Perfil de ${usuario.nome || usuario.email || 'usuário'} alterado para ${this.labels[usuario.role] ?? usuario.role}`);
  }
}