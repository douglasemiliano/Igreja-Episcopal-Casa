import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../services/supabase.service';
import { SeletorImagemComponent } from '../utils/seletor-imagem/seletor-imagem.component';

@Component({ selector: 'app-agenda', standalone: true, imports: [CommonModule, FormsModule, DatePipe, SeletorImagemComponent], templateUrl: './agenda.component.html', styleUrl: './agenda.component.scss' })
export class AgendaComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  eventos: any[] = [];
  carregando = true;
  salvando = false;
  erro = '';
  filtroTipo = '';
  form = this.novoForm();
  editandoId = '';
  tipos = ['culto', 'reuniao', 'batismo', 'casamento', 'arrecadacao', 'escala', 'outro'];
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
  iniciarEdicao(evento: any): void {
    if (!this.podeEditar) return;
    this.editandoId = evento.id;
    this.imagemArquivo = null;
    this.imagemRemovida = false;
    this.form = { ...evento, inicio: this.toInputDate(evento.inicio), fim: evento.fim ? this.toInputDate(evento.fim) : '' };
  }
  cancelar(): void {
    this.editandoId = '';
    this.imagemArquivo = null;
    this.imagemRemovida = false;
    this.form = this.novoForm();
    // O formulário continua na árvore depois de salvar, então a prévia da capa
    // precisa ser liberada por aqui.
    this.seletorCapa?.limpar();
  }
  async salvar(): Promise<void> {
    if (!this.podeEditar) return;
    if (!this.form.titulo || !this.form.inicio) { this.erro = 'Informe título e data de início.'; return; }

    this.salvando = true;
    this.erro = '';

    const capaAtual = this.editandoId ? this.form.imagem_url || null : null;

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

    const payload: any = { ...this.form, inicio: new Date(this.form.inicio).toISOString(), fim: this.form.fim ? new Date(this.form.fim).toISOString() : null };
    delete payload.id;
    /*
     * A chave só entra no payload quando houve upload ou remoção. Sem isso, um
     * evento novo sem foto mandaria `imagem_url: ''`, que a CHECK constraint do
     * banco rejeita por não ser uma URL do bucket.
     */
    if (imagemUrl !== undefined) payload.imagem_url = imagemUrl;

    const response = this.editandoId ? await this.supabase.updateAgenda(this.editandoId, payload) : await this.supabase.addAgenda(payload);

    this.salvando = false;

    if (response.error) {
      this.erro = 'Não foi possível salvar o evento.';
      // Rollback da capa que já tinha subido.
      if (typeof imagemUrl === 'string') void this.supabase.removerImagem(imagemUrl);
      return;
    }

    /*
     * A capa antiga só pode ir embora depois que o evento deixou de apontar
     * para ela. Isso vale tanto para troca quanto para remoção — deixar o
     * arquivo para trás seria órfão ocupando cota no bucket. Quando nada
     * mudou, `imagemUrl` fica undefined e a capa segue a mesma, logo não há
     * o que apagar.
     */
    if (capaAtual && capaAtual !== (imagemUrl !== undefined ? imagemUrl : capaAtual)) {
      void this.supabase.removerImagem(capaAtual);
    }

    this.cancelar(); await this.carregar();
  }
  async excluir(evento: any): Promise<void> {
    if (!this.podeEditar) return;
    if (!confirm(`Excluir ${evento.titulo}?`)) return;
    const { error } = await this.supabase.deleteAgenda(evento.id);
    if (error) { this.erro = 'Não foi possível excluir o evento.'; return; }
    // Sem registro não há mais ninguém apontando para a capa.
    if (evento.imagem_url) void this.supabase.removerImagem(evento.imagem_url);
    await this.carregar();
  }
  private novoForm(): any { return { titulo: '', tipo: 'culto', inicio: '', fim: '', local: '', responsaveis: '', observacoes: '' }; }
  private toInputDate(data: string): string { return new Date(data).toISOString().slice(0, 16); }
}
