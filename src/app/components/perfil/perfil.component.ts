import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { CoreService } from '../../services/core.service';
import { MembroVinculoService } from '../../services/membro-vinculo.service';
import { SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { MembroVinculo } from '../../model/membro.model';

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
  private readonly vinculo = inject(MembroVinculoService);

  fotoUsuario = '';
  nomeUsuario = 'Usuário';
  emailUsuario = 'Email não informado';
  roles: string[] = ['membro'];

  /**
   * O cadastro do membro, que é a fonte da verdade desta tela.
   *
   * `null` enquanto não consultou; `existe: false` quando a conta não tem linha
   * em `membros` — o caso de um administrador que nunca passou pela lista. Não
   * é erro, e a tela mostra o que tem e explica o que falta.
   */
  readonly membro = signal<MembroVinculo | null>(null);
  readonly carregando = signal<boolean>(true);

  /** Nome do membro quando existe, e o da conta só como reserva. */
  private nomeConta = '';

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

  /**
   * Sem linha em `membros` não há o que salvar: a função do banco devolve
   * `sem_vinculo`, e esconder o formulário é melhor do que deixar a pessoa
   * preencher um cadastro que não existe para onde ir.
   */
  get temCadastro(): boolean {
    return this.membro()?.existe === true;
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
  telefone = '';
  dataNascimento = '';
  sexo = '';
  endereco = '';
  funcao = '';
  /** Pré-visualização da foto enquanto a edição está aberta. */
  previaFoto = '';

  /** URL que já falhou ao carregar; o Google às vezes responde 429. */
  private fotoQueFalhou = '';
  /** Ligados por `ngModel` no template, então precisam ser públicos. */
  novaSenha = '';
  confirmarSenha = '';
  @ViewChild('inputFoto') inputFoto?: ElementRef<HTMLInputElement>;

  async ngOnInit(): Promise<void> {
    const [sessao, roles, membro] = await Promise.all([
      this.supabase.getSession(),
      this.supabase.getRoles(),
      this.vinculo.meuMembro()
    ]);

    this.membro.set(membro);

    const user = sessao.data?.session?.user;
    if (user) {
      const metadata = user.user_metadata ?? {};
      this.fotoUsuario = metadata['avatar_url'] || '';
      this.nomeConta =
        metadata['name'] || metadata['full_name'] || user.email?.split('@')[0] || 'Usuário';
      this.emailUsuario = user.email || 'Email não informado';
    }

    // O nome do membro tem precedência sobre o do Google. A lista de membros é
    // o cadastro oficial da igreja, e mostrar outro nome aqui só criava duas
    // verdades para a mesma pessoa.
    this.nomeUsuario = membro.nome || this.nomeConta;
    this.roles = roles;
    this.preencherFormulario();

    this.podeAlterarSenha = await this.supabase.loginComSenha();
    this.carregando.set(false);
  }

  private preencherFormulario(): void {
    const m = this.membro();
    this.novoNome = this.nomeUsuario;
    this.telefone = m?.telefone ?? '';
    this.dataNascimento = m?.data_nascimento ?? '';
    this.sexo = m?.sexo ?? '';
    this.endereco = m?.endereco ?? '';
    this.funcao = m?.funcao ?? '';
  }

  /** Data de nascimento em dd/mm/aaaa, que é como o brasileiro lê. */
  get dataNascimentoBruta(): string {
    if (!this.dataNascimento) return '';
    const [ano, mes, dia] = this.dataNascimento.split('-');
    return dia && mes && ano ? `${dia}/${mes}/${ano}` : this.dataNascimento;
  }

  iniciarEdicao(): void {
    this.editando = true;
    this.preencherFormulario();
    this.previaFoto = this.fotoUsuario;
    this.novaSenha = '';
    this.confirmarSenha = '';
  }

  cancelarEdicao(): void {
    this.editando = false;
    this.preencherFormulario();
    this.previaFoto = this.fotoUsuario;
    this.novaSenha = '';
    this.confirmarSenha = '';
  }

  /**
   * Só o nome tem comparação — é o único campo com texto que o usuário digitou
   * de propósito. Telefone e endereço mudam o tempo todo, e exigir que batam
   * com o valor salvo só atrapalha quem preencheu a esquerda e esqueceu a
   * direita.
   */
  get nomeAlterado(): boolean {
    return this.novoNome.trim() !== this.nomeUsuario;
  }

  get algoAlterado(): boolean {
    return (
      this.nomeAlterado ||
      this.telefone !== (this.membro()?.telefone ?? '') ||
      this.dataNascimento !== (this.membro()?.data_nascimento ?? '') ||
      this.sexo !== (this.membro()?.sexo ?? '') ||
      this.endereco !== (this.membro()?.endereco ?? '') ||
      this.funcao !== (this.membro()?.funcao ?? '')
    );
  }

  async salvarDados(): Promise<void> {
    const nome = this.novoNome.trim();
    if (nome.length < 2) {
      this.toast.erro('O nome precisa ter ao menos 2 caracteres');
      return;
    }
    if (!this.temCadastro || !this.algoAlterado) return;

    this.salvando = true;
    const resultado = await this.supabase.atualizarMeuPerfil({
      nome,
      telefone: this.telefone,
      // '' numa coluna date é erro no Postgres; a função espera null.
      dataNascimento: this.dataNascimento || null,
      sexo: this.sexo,
      endereco: this.endereco,
      funcao: this.funcao
    });
    this.salvando = false;

    if (resultado.status === 'sem_vinculo') {
      this.toast.erro(
        resultado.mensagem ?? 'Esta conta ainda não tem um cadastro de membro vinculado.'
      );
      return;
    }

    if (resultado.status !== 'ok') {
      this.toast.erro(resultado.mensagem ?? 'Não foi possível salvar.');
      return;
    }

    // Recarrega do banco em vez de confiar no formulário: o que vale é o que
    // gravou, com o que o Postgres normalizou.
    const atualizado = await this.vinculo.meuMembro();
    this.membro.set(atualizado);
    this.nomeUsuario = atualizado.nome || nome;
    this.preencherFormulario();

    // O cabeçalho lê o nome de `profiles`, que a função espelha junto.
    this.coreService.atualizarNome(this.nomeUsuario);

    if (resultado.perfilSincronizado === false) {
      // Salvou o que importa (o cadastro do membro) e falhou só o espelho do
      // cabeçalho. Falhar o toast de sucesso aqui esconderia que gravou.
      this.toast.erro(
        resultado.mensagem ?? 'Cadastro salvo, mas o nome do cabeçalho não foi atualizado.'
      );
      return;
    }

    this.toast.sucesso('Cadastro atualizado');
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
