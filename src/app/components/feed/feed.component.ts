import { CommonModule, TitleCasePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { CoreService } from '../../services/core.service';
import { SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { PostagemComponent } from './postagem/postagem.component';

/** Item unificado do feed: evento da agenda ou publicação. */
interface ItemFeed {
  tipo: 'evento' | 'publicacao';
  id: string;
  data: string;
  publicacao?: any;
  evento?: any;
}

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, FormsModule, TitleCasePipe, MatIconModule, RouterModule, PostagemComponent],
  templateUrl: './feed.component.html',
  styleUrl: './feed.component.scss'
})
export class FeedComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly core = inject(CoreService);

  /** Somente administrador e líder publicam. */
  readonly rolesPublicadores = ['administrador', 'lider'];

  /** Eventos futuros ficam no topo; publicações vêm por recência. */
  itens: ItemFeed[] = [];
  roles: string[] = ['membro'];
  usuarioAtualId = '';
  minhaFoto = '';

  carregando = true;
  enviando = false;
  erro = '';

  conteudo = '';

  /** URL que já falhou ao carregar; o Google às vezes responde 429. */
  private fotoQueFalhou = '';

  get semFoto(): boolean {
    return !this.minhaFoto || this.fotoQueFalhou === this.minhaFoto;
  }

  registrarErroFoto(url: string): void {
    this.fotoQueFalhou = url;
  }

  constructor() {
    this.core.usuario$.subscribe({
      next: (usuario) => (this.minhaFoto = usuario.foto)
    });

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
      console.error('Falha parcial ao carregar o feed', { publicacoes, eventos });
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
      this.erro = 'Não foi possível carregar o feed.';
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

  /** "agora", "há 5 min", "há 2 h", "há 3 d" — usado no card de evento. */
  tempoRelativo(iso: string): string {
    const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `há ${horas} h`;
    const dias = Math.floor(horas / 24);
    if (dias < 7) return `há ${dias} d`;
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  /** Data por extenso para o tooltip do timestamp do evento. */
  dataCompleta(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR');
  }
}
