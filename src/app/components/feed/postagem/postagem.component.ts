import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  Output,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { SupabaseService } from '../../../services/supabase.service';
import { ToastService } from '../../../services/toast.service';
import { SeletorImagemComponent } from '../../utils/seletor-imagem/seletor-imagem.component';

/**
 * Card de publicação do feed, com dois modos: visualização e edição.
 *
 * A edição acontece dentro do próprio card: o post não sai do lugar, então
 * editar o último item da lista não joga o texto para o formulário do topo.
 */
@Component({
  selector: 'app-postagem',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, SeletorImagemComponent],
  templateUrl: './postagem.component.html',
  styleUrl: './postagem.component.scss'
})
export class PostagemComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  @Input({ required: true }) publicacao!: any;
  /** Autor e administrador editam; os demais veem só a leitura. */
  @Input() podeEditar = false;
  /** Dispara quando o conteúdo muda, para o feed recarregar a lista. */
  @Output() alterado = new EventEmitter<void>();

  @ViewChild('campo') campo?: ElementRef<HTMLTextAreaElement>;

  editando = false;
  rascunho = '';
  salvando = false;
  menuAberto = false;

  /** Foto escolhida no modo de edição; só sobe para o storage ao salvar. */
  imagemArquivo: File | null = null;
  /** Foto atual foi removida de propósito: a coluna deve ser limpa. */
  imagemRemovida = false;
  /** A URL existia mas não carregou (429 do Storage, 404); some com a imagem. */
  imagemFalhou = false;

  /**
   * URL que já falhou ao carregar. O Google responde 429 quando o volume de
   * requisições estoura, e aí a imagem viraria um ícone quebrado. Guardar a
   * URL em vez de um booleano faz a nova foto ser tentada de novo sozinha.
   */
  private fotoQueFalhou = '';

  private readonly labelsRole: Record<string, string> = {
    administrador: 'Administrador',
    secretaria: 'Secretaria',
    caixa: 'Caixa',
    tesouraria: 'Tesouraria',
    pastor: 'Pastor',
    lider: 'Líder',
    membro: 'Membro',
    leitor: 'Membro'
  };

  get autorNome(): string {
    return this.publicacao.autor?.nome || this.publicacao.autor?.email || 'Usuário';
  }

  /** Avatar do autor; vazio quando não há foto, caindo nas iniciais. */
  get autorFoto(): string {
    return this.publicacao.autor?.foto || '';
  }

  get semFoto(): boolean {
    return !this.autorFoto || this.fotoQueFalhou === this.autorFoto;
  }

  registrarErroFoto(url: string): void {
    this.fotoQueFalhou = url;
  }

  get autorRoles(): string[] {
    const roles: string[] = Array.isArray(this.publicacao.autor?.roles)
      ? this.publicacao.autor.roles
      : [];
    return roles.map((role) => this.labelsRole[role] ?? role);
  }

  get iniciais(): string {
    return this.autorNome
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join('');
  }

  /** "agora", "há 5 min", "há 2 h", "há 3 d" — para o cabeçalho do post. */
  get tempoRelativo(): string {
    const minutos = Math.floor((Date.now() - new Date(this.publicacao.criado_em).getTime()) / 60000);
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `há ${horas} h`;
    const dias = Math.floor(horas / 24);
    if (dias < 7) return `há ${dias} d`;
    return new Date(this.publicacao.criado_em).toLocaleDateString('pt-BR');
  }

  /** Data por extenso para o tooltip do timestamp. */
  get dataCompleta(): string {
    return new Date(this.publicacao.criado_em).toLocaleString('pt-BR');
  }

  /**
   * O clique no gatilho precisa ficar no componente: sem o stopPropagation a
   * janela fecha o menu no mesmo evento que o abriu.
   */
  alternarMenu(event: Event): void {
    event.stopPropagation();
    this.menuAberto = !this.menuAberto;
  }

  /** Clique em qualquer lugar fora do card fecha o menu. */
  @HostListener('document:click')
  fecharMenu(): void {
    this.menuAberto = false;
  }

  /** Esc cancela a edição; fora dela, só fecha o menu. */
  @HostListener('document:keydown.escape')
  aoPressionarEsc(): void {
    if (this.editando) {
      this.cancelar();
      return;
    }
    this.menuAberto = false;
  }

  iniciarEdicao(): void {
    if (!this.podeEditar || this.salvando) return;
    this.menuAberto = false;
    this.rascunho = this.publicacao.conteudo ?? '';
    this.imagemArquivo = null;
    this.imagemRemovida = false;
    this.editando = true;
    // O textarea só existe depois que `editando` vira true e o Angular renderiza.
    setTimeout(() => this.campo?.nativeElement.focus());
  }

  cancelar(): void {
    this.editando = false;
    this.rascunho = '';
    this.imagemArquivo = null;
    this.imagemRemovida = false;
  }

  async salvar(): Promise<void> {
    const texto = this.rascunho.trim();
    if (!texto || this.salvando) return;

    this.salvando = true;

    let imagemUrl: string | null | undefined;
    const fotoAntiga = this.publicacao.imagem_url || null;

    if (this.imagemArquivo) {
      const resultado = await this.supabase.enviarImagemPostagem(this.imagemArquivo);
      if ('erro' in resultado) {
        this.salvando = false;
        console.error(resultado.erro);
        this.toast.erro(resultado.erro);
        return;
      }
      imagemUrl = resultado.url;
    } else if (this.imagemRemovida) {
      imagemUrl = null;
    }

    const { error } = await this.supabase.editarFeed(this.publicacao.id, texto, imagemUrl);

    if (error) {
      console.error(error);
      if (typeof imagemUrl === 'string') {
        void this.supabase.removerImagem(imagemUrl);
      }
      this.salvando = false;
      this.toast.erro('Não foi possível salvar a alteração');
      return;
    }

    this.salvando = false;
    this.editando = false;
    this.rascunho = '';
    this.imagemArquivo = null;
    this.imagemRemovida = false;
    this.imagemFalhou = false;

    // A foto trocada só pode ir embora depois que o post apontou para a nova.
    // `imagemUrl` só é string quando houve upload; se ficou undefined, a
    // coluna não foi tocada e apagar a foto atual quebraria a publicação.
    if (fotoAntiga && typeof imagemUrl === 'string') {
      void this.supabase.removerImagem(fotoAntiga);
    }

    this.toast.sucesso('Atualização editada');
    this.alterado.emit();
  }

  async remover(): Promise<void> {
    if (!this.podeEditar || this.salvando) return;
    this.menuAberto = false;
    if (!confirm('Remover esta publicação do feed?')) return;

    const { error } = await this.supabase.excluirFeed(this.publicacao.id);
    if (error) {
      console.error(error);
      this.toast.erro('Não foi possível remover a atualização');
      return;
    }

    if (this.publicacao.imagem_url) {
      void this.supabase.removerImagem(this.publicacao.imagem_url);
    }

    this.toast.sucesso('Atualização removida');
    this.alterado.emit();
  }
}
