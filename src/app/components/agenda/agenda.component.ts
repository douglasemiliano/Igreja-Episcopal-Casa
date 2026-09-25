import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../services/supabase.service';

@Component({ selector: 'app-agenda', standalone: true, imports: [CommonModule, FormsModule, DatePipe], templateUrl: './agenda.component.html', styleUrl: './agenda.component.scss' })
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
    this.form = { ...evento, inicio: this.toInputDate(evento.inicio), fim: evento.fim ? this.toInputDate(evento.fim) : '' };
  }
  cancelar(): void { this.editandoId = ''; this.form = this.novoForm(); }
  async salvar(): Promise<void> {
    if (!this.podeEditar) return;
    if (!this.form.titulo || !this.form.inicio) { this.erro = 'Informe título e data de início.'; return; }
    this.salvando = true;
    const payload = { ...this.form, inicio: new Date(this.form.inicio).toISOString(), fim: this.form.fim ? new Date(this.form.fim).toISOString() : null };
    delete payload.id;
    const response = this.editandoId ? await this.supabase.updateAgenda(this.editandoId, payload) : await this.supabase.addAgenda(payload);
    this.salvando = false;
    if (response.error) { this.erro = 'Não foi possível salvar o evento.'; return; }
    this.cancelar(); await this.carregar();
  }
  async excluir(evento: any): Promise<void> {
    if (!this.podeEditar) return;
    if (!confirm(`Excluir ${evento.titulo}?`)) return;
    await this.supabase.deleteAgenda(evento.id);
    await this.carregar();
  }
  private novoForm(): any { return { titulo: '', tipo: 'culto', inicio: '', fim: '', local: '', responsaveis: '', observacoes: '' }; }
  private toInputDate(data: string): string { return new Date(data).toISOString().slice(0, 16); }
}
