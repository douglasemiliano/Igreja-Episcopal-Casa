import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';

/** Item unificado do mural: evento da agenda ou publicação do feed. */
interface ItemMural {
  tipo: 'evento' | 'publicacao';
  id: string;
  data: string;
  publicacao?: any;
  evento?: any;
}

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, TitleCasePipe, MatIconModule, RouterModule],
  templateUrl: './feed.component.html',
  styleUrl: './feed.component.scss'
})
export class FeedComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

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
  /** Somente administrador e líder publicam. */
  readonly rolesPublicadores = ['administrador', 'lider'];

  /** Eventos futuros ficam no topo; publicações vêm por recência. */
  itens: ItemMural[] = [];
  roles: string[] = ['membro'];
  usuarioAtualId = '';

  carregando = true;
  enviando = false;
  erro = '';

  conteudo = '';
  editandoId = '';
  editandoConteudo = '';

  constructor() {
    void this.supabase
      .getUser()
      .then((user) => (this.usuarioAtualId = user?.id ?? ''))
      .catch(() => undefined);
  }

  async ngOnInit(): Promise<void> {
    await this.carregar();
    try {
      this.roles = await this.supabase.getRoles();
    } catch (erro) {
      console.error('Não foi possível carregar os perfis:', erro);
    }
  }

  get podePublicar(): boolean {
    return this.rolesPublicadores.some((role) => this.roles.includes(role));
  }

  get totalEventos(): number {
    return this.itens.filter((item) => item.tipo === 'evento').length;
  }

  ehAutor(publicacao: any): boolean {
    return publicacao.autor_id === this.usuarioAtualId;
  }

  podeEditar(publicacao: any): boolean {
    return this.ehAutor(publicacao) || this.roles.includes('administrador');
  }

  async carregar(): Promise<void> {
    this.carregando = true;
    this.erro = '';

    // Publicações e eventos futuros são carregados em paralelo: um erro
    // em um deles não pode esconder o outro.
    const [publicacoes, eventos] = await Promise.allSettled([
      this.supabase.getFeed(),
      this.supabase.getProximosEventos()
    ]);

    const listaPublicacoes: any[] =
      publicacoes.status === 'fulfilled' && !publicacoes.value.error
        ? publicacoes.value.data ?? []
        : [];

    const listaEventos: any[] =
      eventos.status === 'fulfilled' && !eventos.value.error ? eventos.value.data ?? [] : [];

    if (publicacoes.status === 'rejected' || eventos.status === 'rejected') {
      console.error('Falha parcial ao carregar o mural', { publicacoes, eventos });
    }
    if (publicacoes.status === 'fulfilled' && publicacoes.value.error) {
      console.error(publicacoes.value.error);
    }
    if (eventos.status === 'fulfilled' && eventos.value.error) {
      console.error(eventos.value.error);
    }

    this.itens = [
      ...listaEventos.map((evento) => ({
        tipo: 'evento' as const,
        id: evento.id,
        data: evento.inicio,
        evento
      })),
      ...listaPublicacoes.map((publicacao) => ({
        tipo: 'publicacao' as const,
        id: publicacao.id,
        data: publicacao.criado_em,
        publicacao
      }))
    ].sort((a, b) => {
      // Eventos primeiro (próximos), publicaciones por recência.
      if (a.tipo !== b.tipo) return a.tipo === 'evento' ? -1 : 1;
      return a.tipo === 'evento'
        ? new Date(a.data).getTime() - new Date(b.data).getTime()
        : new Date(b.data).getTime() - new Date(a.data).getTime();
    });

    if (!listaPublicacoes.length && publicacoes.status === 'fulfilled' && publicacoes.value.error) {
      this.erro = 'Não foi possível carregar o mural.';
    }

    this.carregando = false;
  }

  async publicar(): Promise<void> {
    const texto = this.conteudo.trim();
    if (!texto || this.enviando) return;

    this.enviando = true;
    const { error } = await this.supabase.publicarFeed(texto);
    this.enviando = false;

    if (error) {
      console.error(error);
      this.toast.erro('Não foi possível publicar a atualização');
      return;
    }

    this.conteudo = '';
    this.toast.sucesso('Atualização publicada');
    await this.carregar();
  }

  iniciarEdicao(publicacao: any): void {
    if (!this.podeEditar(publicacao)) return;
    this.editandoId = publicacao.id;
    this.editandoConteudo = publicacao.conteudo;
  }

  cancelarEdicao(): void {
    this.editandoId = '';
    this.editandoConteudo = '';
  }

  async salvarEdicao(): Promise<void> {
    const texto = this.editandoConteudo.trim();
    if (!texto || !this.editandoId) return;

    this.enviando = true;
    const { error } = await this.supabase.editarFeed(this.editandoId, texto);
    this.enviando = false;

    if (error) {
      console.error(error);
      this.toast.erro('Não foi possível salvar a alteração');
      return;
    }

    this.cancelarEdicao();
    await this.carregar();
  }

  async excluir(publicacao: any): Promise<void> {
    if (!this.podeEditar(publicacao)) return;
    if (!confirm('Remover esta atualização do mural?')) return;

    const { error } = await this.supabase.excluirFeed(publicacao.id);
    if (error) {
      console.error(error);
      this.toast.erro('Não foi possível remover a atualização');
      return;
    }

    this.toast.sucesso('Atualização removida');
    await this.carregar();
  }

  autorNome(publicacao: any): string {
    return publicacao.autor?.nome || publicacao.autor?.email || 'Usuário';
  }

  /** Avatar do autor; vazio quando não há foto, caindo nas iniciais. */
  autorFoto(publicacao: any): string {
    return publicacao.autor?.foto || '';
  }

  autorRoles(publicacao: any): string[] {
    const roles: string[] = Array.isArray(publicacao.autor?.roles) ? publicacao.autor.roles : [];
    return roles.map((role) => this.labelsRole[role] ?? role);
  }

  iniciais(nome: string): string {
    return nome
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join('');
  }
}
