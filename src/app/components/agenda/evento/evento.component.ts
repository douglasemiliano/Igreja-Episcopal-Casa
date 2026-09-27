import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, inject, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../services/supabase.service';
import { ToastService } from '../../../services/toast.service';
import { SeletorImagemComponent } from '../../utils/seletor-imagem/seletor-imagem.component';

/**
 * Card de evento da agenda, com dois modos: visualização e edição.
 *
 * A edição acontece dentro do próprio card. Antes ela vivia no formulário do
 * topo: no desktop era um painel à esquerda e no mobile ficava acima da lista,
 * então editar o último evento jogava a pessoa para o topo da tela e ela
 * perdia o lugar. Aqui o evento não sai do lugar — só troca o conteúdo.
 */
@Component({
  selector: 'app-evento',
  standalone: true,
  imports: [CommonModule, FormsModule, SeletorImagemComponent],
  templateUrl: './evento.component.html',
  styleUrl: './evento.component.scss'
})
export class EventoComponent implements OnChanges {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  /** O evento da lista. Nunca é copiado: o rascunho vive em `form`. */
  @Input({ required: true }) evento!: any;
  @Input() podeEditar = false;
  /** Dispara quando o evento muda, para a agenda recarregar a lista. */
  @Output() alterado = new EventEmitter<void>();

  @ViewChild('campoTitulo') campoTitulo?: ElementRef<HTMLInputElement>;

  tipos = ['culto', 'reuniao', 'batismo', 'casamento', 'arrecadacao', 'escala', 'outro'];

  editando = false;
  salvando = false;
  erro = '';
  form = this.novoForm();

  /** Capa escolhida no modo de edição; só sobe para o storage ao salvar. */
  imagemArquivo: File | null = null;
  /** A capa atual foi removida de propósito: a coluna deve ser limpa. */
  imagemRemovida = false;
  /** A URL existia mas não carregou; some com a imagem em vez de virar ícone quebrado. */
  private capaQueFalhou = '';

  /**
   * A lista recarrega inteira depois de salvar, o que entrega um objeto novo
   * para o mesmo `id`. Sem isto, quem abrisse a edição de outro evento depois
   * disso receberia o rascunho velho.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['evento'] && !changes['evento'].firstChange) {
      this.cancelar();
    }
  }

  get temCapa(): boolean {
    return !!this.evento?.imagem_url && this.capaQueFalhou !== this.evento.imagem_url;
  }

  registrarErroCapa(url: string): void {
    this.capaQueFalhou = url;
  }

  iniciarEdicao(): void {
    if (!this.podeEditar || this.salvando) return;
    this.erro = '';
    this.imagemArquivo = null;
    this.imagemRemovida = false;
    this.form = {
      titulo: this.evento.titulo ?? '',
      tipo: this.evento.tipo ?? 'culto',
      inicio: this.toInputDate(this.evento.inicio),
      fim: this.evento.fim ? this.toInputDate(this.evento.fim) : '',
      local: this.evento.local ?? '',
      responsaveis: this.evento.responsaveis ?? '',
      observacoes: this.evento.observacoes ?? '',
      imagem_url: this.evento.imagem_url ?? ''
    };
    this.editando = true;
    // O input só existe depois que `editando` vira true e o Angular renderiza.
    setTimeout(() => this.campoTitulo?.nativeElement.focus());
  }

  cancelar(): void {
    this.editando = false;
    this.erro = '';
    this.form = this.novoForm();
    this.imagemArquivo = null;
    this.imagemRemovida = false;
  }

  async salvar(): Promise<void> {
    if (this.salvando) return;
    if (!this.form.titulo?.trim() || !this.form.inicio) {
      this.erro = 'Informe título e data de início.';
      return;
    }

    this.salvando = true;
    this.erro = '';

    const capaAtual = this.evento.imagem_url || null;

    /*
     * A capa sobe antes do update: se a gravação falhar, o arquivo recién
     * enviado é removido para não ficar ocupando cota no bucket.
     */
    let imagemUrl: string | null | undefined;
    if (this.imagemArquivo) {
      const resultado = await this.supabase.enviarImagemEvento(this.imagemArquivo);
      if ('erro' in resultado) {
        this.salvando = false;
        this.erro = resultado.erro;
        return;
      }
      imagemUrl = resultado.url;
    } else if (this.imagemRemovida) {
      imagemUrl = null;
    }

    const payload: any = {
      titulo: this.form.titulo.trim(),
      tipo: this.form.tipo,
      inicio: new Date(this.form.inicio).toISOString(),
      fim: this.form.fim ? new Date(this.form.fim).toISOString() : null,
      local: this.form.local,
      responsaveis: this.form.responsaveis,
      observacoes: this.form.observacoes
    };
    /*
     * A chave só entra no payload quando houve upload ou remoção. Sem isso, um
     * evento sem troca de capa mandaria `imagem_url: ''`, que a CHECK constraint
     * do banco rejeita por não ser uma URL do bucket.
     */
    if (imagemUrl !== undefined) payload.imagem_url = imagemUrl;

    const { error } = await this.supabase.updateAgenda(this.evento.id, payload);
    this.salvando = false;

    if (error) {
      console.error(error);
      if (typeof imagemUrl === 'string') void this.supabase.removerImagem(imagemUrl);
      this.erro = 'Não foi possível salvar o evento.';
      return;
    }

    /*
     * A capa antiga só pode ir embora depois que o evento deixou de apontar
     * para ela. Vale para troca e para remoção: deixar o arquivo para trás
     * seria órfão ocupando cota no bucket.
     *
     * `imagemUrl === undefined` significa que nada mudou na capa, e aí não há
     * o que apagar. Já `null` significa remoção deliberada, e nesse caso o
     * arquivo anterior precisa sumir.
     */
    if (capaAtual && imagemUrl !== undefined && imagemUrl !== capaAtual) {
      void this.supabase.removerImagem(capaAtual);
    }

    this.capaQueFalhou = '';
    this.cancelar();
    this.toast.sucesso('Evento atualizado');
    this.alterado.emit();
  }

  async excluir(): Promise<void> {
    if (!this.podeEditar || this.salvando) return;
    if (!confirm(`Excluir ${this.evento.titulo}?`)) return;

    const { error } = await this.supabase.deleteAgenda(this.evento.id);
    if (error) {
      console.error(error);
      this.toast.erro('Não foi possível excluir o evento.');
      return;
    }

    // Sem registro não há mais ninguém apontando para a capa.
    if (this.evento.imagem_url) void this.supabase.removerImagem(this.evento.imagem_url);

    this.toast.sucesso('Evento excluído');
    this.alterado.emit();
  }

  private novoForm(): any {
    return { titulo: '', tipo: 'culto', inicio: '', fim: '', local: '', responsaveis: '', observacoes: '', imagem_url: '' };
  }

  /** `datetime-local` precisa de "YYYY-MM-DDTHH:mm" no fuso local, não em UTC. */
  private toInputDate(data: string): string {
    const d = new Date(data);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
