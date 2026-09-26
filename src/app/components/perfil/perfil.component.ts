import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { CoreService } from '../../services/core.service';
import { SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, RouterModule],
  templateUrl: './perfil.component.html',
  styleUrl: './perfil.component.scss'
})
export class PerfilComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly coreService = inject(CoreService);

  fotoUsuario = '';
  nomeUsuario = 'Usuário';
  emailUsuario = 'Email não informado';
  roles: string[] = ['membro'];
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

  get labels(): string[] {
    return this.roles.map((role) => this.labelsRole[role] ?? role);
  }

  /** Foto exibida no avatar: a pré-visualização enquanto edita, a salva caso contrário. */
  get fotoExibida(): string {
    return this.editando ? this.previaFoto : this.fotoUsuario;
  }

  get semFoto(): boolean {
    return !this.fotoExibida || this.fotoQueFalhou === this.fotoExibida;
  }

  registrarErroFoto(url: string): void {
    this.fotoQueFalhou = url;
  }

  // --- edição ---
  editando = false;
  salvando = false;
  salvandoFoto = false;
  salvandoSenha = false;
  /** false quando o login foi pelo Google (não há senha local). */
  podeAlterarSenha = true;

  novoNome = '';
  previaFoto = '';
  /** URL que já falhou ao carregar; o Google às vezes responde 429. */
  private fotoQueFalhou = '';
  novaSenha = '';
  confirmarSenha = '';
  @ViewChild('inputFoto') inputFoto?: ElementRef<HTMLInputElement>;

  async ngOnInit(): Promise<void> {
    const [{ data }, roles] = await Promise.all([
      this.supabase.getSession(),
      this.supabase.getRoles()
    ]);

    const session = data?.session;
    if (session) {
      const user = session.user;
      const metadata = user.user_metadata ?? {};
      this.fotoUsuario = metadata['avatar_url'] || '';
      this.nomeUsuario =
        metadata['name'] || metadata['full_name'] || user.email?.split('@')[0] || 'Usuário';
      this.emailUsuario = user.email || 'Email não informado';
    }

    this.roles = roles;
    this.novoNome = this.nomeUsuario;

    this.podeAlterarSenha = await this.supabase.loginComSenha();
  }

  iniciarEdicao(): void {
    this.editando = true;
    this.novoNome = this.nomeUsuario;
    this.previaFoto = this.fotoUsuario;
    this.novaSenha = '';
    this.confirmarSenha = '';
  }

  cancelarEdicao(): void {
    this.editando = false;
    this.novoNome = this.nomeUsuario;
    this.previaFoto = this.fotoUsuario;
    this.novaSenha = '';
    this.confirmarSenha = '';
  }

  get nomeAlterado(): boolean {
    return this.novoNome.trim() !== this.nomeUsuario;
  }

  async salvarNome(): Promise<void> {
    const nome = this.novoNome.trim();
    if (nome.length < 2) {
      this.toast.erro('O nome precisa ter ao menos 2 caracteres');
      return;
    }
    if (!this.nomeAlterado) return;

    this.salvando = true;
    const { erro } = await this.supabase.atualizarNome(nome);
    this.salvando = false;

    if (erro) {
      this.toast.erro(erro);
      return;
    }

    this.nomeUsuario = nome;
    this.coreService.atualizarNome(nome);
    this.toast.sucesso('Nome atualizado');
  }

  /** Abre o seletor de arquivos ao clicar na foto. */
  abrirSelecaoFoto(): void {
    if (this.salvandoFoto) return;
    this.inputFoto?.nativeElement.click();
  }

  async selecionarArquivo(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const arquivo = input.files?.[0];
    if (!arquivo) return;

    this.salvandoFoto = true;
    const resultado = await this.supabase.uploadAvatar(arquivo);
    this.salvandoFoto = false;
    input.value = '';

    if ('erro' in resultado) {
      this.toast.erro(resultado.erro);
      return;
    }

    this.fotoUsuario = resultado.url;
    this.previaFoto = resultado.url;
    this.coreService.atualizarFoto(resultado.url);
    this.toast.sucesso('Foto atualizada');
  }

  async salvarSenha(): Promise<void> {
    if (this.novaSenha.length < 6) {
      this.toast.erro('A nova senha deve ter no mínimo 6 caracteres');
      return;
    }
    if (this.novaSenha !== this.confirmarSenha) {
      this.toast.erro('As senhas não conferem');
      return;
    }

    this.salvandoSenha = true;
    const { erro } = await this.supabase.atualizarSenha(this.novaSenha);
    this.salvandoSenha = false;

    if (erro) {
      this.toast.erro(erro);
      return;
    }

    this.novaSenha = '';
    this.confirmarSenha = '';
    this.toast.sucesso('Senha alterada com sucesso');
  }
}
