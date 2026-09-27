import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../services/supabase.service';
import { EventoComponent } from './evento/evento.component';
import { SeletorImagemComponent } from '../utils/seletor-imagem/seletor-imagem.component';

/**
 * Tela da agenda: o formulário da esquerda é só de criação.
 *
 * Cada evento da lista é um `<app-evento>`, que cuida da própria edição e
 * exclusão em dois modos. Por isso aqui não existe `editandoId` nem "salvar"
 * que decide entre insert e update: salvar neste formulário só insere.
 */
@Component({ selector: 'app-agenda', standalone: true, imports: [CommonModule, FormsModule, EventoComponent, SeletorImagemComponent], templateUrl: './agenda.component.html', styleUrl: './agenda.component.scss' })
export class AgendaComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  eventos: any[] = [];
  carregando = true;
  salvando = false;
  erro = '';
  filtroTipo = '';
  form = this.novoForm();
  tipos = ['culto', 'reuniao', 'batismo', 'casamento', 'arrecadacao', 'escala', 'ação', 'outro'];
  // Somente pastor, secretaria e administrador podem criar/editar/excluir eventos.
  readonly rolesPermitidos = ['administrador', 'secretaria', 'pastor'];
  podeEditar = false;

  /** Capa escolhida no formulário; só sobe para o storage ao salvar. */
  imagemArquivo: File | null = null;
  /** A capa atual foi removida de propósito: a coluna deve ser limpa. */
  imagemRemovida = false;

  @ViewChild('seletorCapa') seletorCapa?: SeletorImagemComponent;

  async ngOnInit(): Promise<void> {
    await this.carregar();
    try {
      const roles = await this.supabase.getRoles();
      this.podeEditar = this.rolesPermitidos.some((role) => roles.includes(role));
    } catch (erro) {
      console.error('Não foi possível carregar o perfil de acesso:', erro);
      this.podeEditar = false;
    }
  }
  async carregar(): Promise<void> {
    this.carregando = true;
    const { data, error } = await this.supabase.getAgenda();
    this.eventos = data ?? [];
    this.erro = error ? 'Não foi possível carregar a agenda.' : '';
    this.carregando = false;
  }
  get eventosFiltrados(): any[] { return this.filtroTipo ? this.eventos.filter((evento) => evento.tipo === this.filtroTipo) : this.eventos; }

  async salvar(): Promise<void> {
    if (!this.podeEditar || this.salvando) return;
    if (!this.form.titulo?.trim() || !this.form.inicio) { this.erro = 'Informe título e data de início.'; return; }

    this.salvando = true;
    this.erro = '';

    // A capa sobe antes do registro: se o insert falhar, o arquivo enviado é
    // removido para não ficar ocupando cota no bucket.
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

    const payload: any = { titulo: this.form.titulo.trim(), tipo: this.form.tipo, inicio: new Date(this.form.inicio).toISOString(), fim: this.form.fim ? new Date(this.form.fim).toISOString() : null, local: this.form.local, responsaveis: this.form.responsaveis, observacoes: this.form.observacoes };
    /*
     * A chave só entra no payload quando houve upload ou remoção. Sem isso, um
     * evento novo sem foto mandaria `imagem_url: ''`, que a CHECK constraint do
     * banco rejeita por não ser uma URL do bucket.
     */
    if (imagemUrl !== undefined) payload.imagem_url = imagemUrl;

    const { error } = await this.supabase.addAgenda(payload);
    this.salvando = false;

    if (error) {
      console.error(error);
      this.erro = 'Não foi possível salvar o evento.';
      // Rollback da capa que já tinha subido.
      if (typeof imagemUrl === 'string') void this.supabase.removerImagem(imagemUrl);
      return;
    }

    this.cancelar(); await this.carregar();
  }

  cancelar(): void {
    this.erro = '';
    this.form = this.novoForm();
    this.imagemArquivo = null;
    this.imagemRemovida = false;
    // O seletor de imagem continua na árvore depois do insert, então a prévia
    // da capa precisa ser liberada por aqui.
    this.seletorCapa?.limpar();
  }
  private novoForm(): any { return { titulo: '', tipo: 'culto', inicio: '', fim: '', local: '', responsaveis: '', observacoes: '' }; }
}
