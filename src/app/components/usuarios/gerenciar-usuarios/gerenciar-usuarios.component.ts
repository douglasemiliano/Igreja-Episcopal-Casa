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
  rolesAtual: string[] = [];
  /** Cópia local das roles por usuário, para editar sem salvar a cada clique. */
  selecao: Record<string, string[]> = {};

  async ngOnInit(): Promise<void> {
    const { data } = await this.supabase.getUserResult();
    this.usuarioAtualId = data.user?.id ?? null;
    this.rolesAtual = await this.supabase.getRoles();
    await this.listar();
  }

  ehUsuarioAtual(id: string): boolean {
    return this.usuarioAtualId === id;
  }

  ehAdministrador(): boolean {
    return this.rolesAtual.includes('administrador');
  }

  // Pastores não alteram o perfil próprio nem de administradores.
  podeGerenciar(usuario: any): boolean {
    if (this.ehUsuarioAtual(usuario.id)) return false;
    if (this.ehAdministrador()) return true;
    return !this.rolesDe(usuario).includes('administrador');
  }

  // Somente administradores podem conceder/alterar o perfil de administrador.
  perfisDisponiveis(): string[] {
    return this.ehAdministrador()
      ? this.roles
      : this.roles.filter((role) => role !== 'administrador');
  }

  rolesDe(usuario: any): string[] {
    const saved = this.selecao[usuario.id];
    if (saved) return saved;
    const doBanco: string[] = Array.isArray(usuario.roles) ? usuario.roles : [];
    return doBanco.length ? doBanco : ['membro'];
  }

  alternarRole(usuario: any, role: string): void {
    if (!this.podeGerenciar(usuario) || this.salvandoId === usuario.id) return;
    const atuais = this.rolesDe(usuario);
    const proximas = atuais.includes(role)
      ? atuais.filter((item) => item !== role)
      : [...atuais, role];
    // Não é possível remover a última role: o perfil 'membro' é o padrão.
    this.selecao[usuario.id] = proximas.length ? proximas : ['membro'];
  }

  temRoleSelecionada(usuario: any, role: string): boolean {
    return this.rolesDe(usuario).includes(role);
  }

  labelDe(usuario: any): string {
    return this.rolesDe(usuario)
      .map((role) => this.labels[role] ?? role)
      .join(' · ');
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
    const roles = this.rolesDe(usuario);
    this.salvandoId = usuario.id;
    const { data, error } = await this.supabase.atualizarRolesUsuario(usuario.id, roles);
    this.salvandoId = null;
    if (error) {
      console.error(error);
      this.toast.erro('Erro ao salvar o perfil do usuário');
      return;
    }
    if (data) usuario.roles = data.roles;
    delete this.selecao[usuario.id];
    this.toast.sucesso(
      `Perfil de ${usuario.nome || usuario.email || 'usuário'} alterado para ${this.labelDe(usuario)}`
    );
  }

  restaurar(usuario: any): void {
    delete this.selecao[usuario.id];
  }

  selectionChanged(usuario: any): boolean {
    const doBanco: string[] = Array.isArray(usuario.roles) && usuario.roles.length ? usuario.roles : ['membro'];
    const Edited = this.rolesDe(usuario);
    return Edited.length !== doBanco.length || Edited.some((role, i) => role !== doBanco[i]);
  }
}