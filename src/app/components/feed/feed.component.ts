import { CommonModule, TitleCasePipe } from '@angular/common';
import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { CoreService } from '../../services/core.service';
import { SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { SeletorImagemComponent } from '../utils/seletor-imagem/seletor-imagem.component';
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
  imports: [
    CommonModule,
    FormsModule,
    TitleCasePipe,
    MatIconModule,
    RouterModule,
    PostagemComponent,
    SeletorImagemComponent
  ],
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

  /** Foto escolhida no composer; só sobe para o storage ao publicar. */
  imagemArquivo: File | null = null;
  @ViewChild('seletorImagem') seletorImagem?: SeletorImagemComponent;

  /** URL que já falhou ao carregar; o Google às vezes responde 429. */
  private fotoQueFalhou = '';

  get semFoto(): boolean {
    return !this.minhaFoto || this.fotoQueFalhou === this.minhaFoto;
  }

  registrarErroFoto(url: string): void {
    this.fotoQueFalhou = url;
  }

  /** Capas de evento que já falharam ao carregar; o Storage às vezes devolve 429. */
  private capasQueFalharam = new Set<string>();

  temCapaEvento(evento: any): boolean {
    return !!evento.imagem_url && !this.capasQueFalharam.has(evento.imagem_url);
  }

  marcarCapaQueFalhou(url: string): void {
    this.capasQueFalharam.add(url);
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
    // A lista recarrega inteira, então as falhas antigas não valem mais.
    this.capasQueFalharam.clear();

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

    /*
     * Ordem única por recência: o que foi publicado mais recentemente fica
     * no topo, evento ou não. Antes o tipo do item decidia a ordem e todo
     * evento ia para cima, de modo que uma postagem recém-criada aparecia
     * abaixo de eventos antigos.
     *
     * A chave é `criado_em` nos dois casos — a mesma que aparece no horário do
     * card. Ordenar o evento pela data em que acontece (`inicio`) não
     * resolveria, já que eventos são sempre futuros e voltariam a flutuar
     * para o topo.
     */
    this.itens = [
      ...listaEventos.map((evento) => ({
        tipo: 'evento' as const,
        id: evento.id,
        data: evento.criado_em,
        evento
      })),
      ...listaPublicacoes.map((publicacao) => ({
        tipo: 'publicacao' as const,
        id: publicacao.id,
        data: publicacao.criado_em,
        publicacao
      }))
    ].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

    if (!listaPublicacoes.length && publicacoes.status === 'fulfilled' && publicacoes.value.error) {
      this.erro = 'Não foi possível carregar o feed.';
    }

    this.carregando = false;
  }

  async publicar(): Promise<void> {
    const texto = this.conteudo.trim();
    if (!texto || this.enviando) return;

    this.enviando = true;

    // A foto vai primeiro: se o insert falhar, o arquivo que subiu é removido
    // para não ficar ocupando cota no bucket.
    let imagemUrl: string | null = null;
    if (this.imagemArquivo) {
      const resultado = await this.supabase.enviarImagemPostagem(this.imagemArquivo);
      if ('erro' in resultado) {
        this.enviando = false;
        console.error(resultado.erro);
        this.toast.erro(resultado.erro);
        return;
      }
      imagemUrl = resultado.url;
    }

    const { error } = await this.supabase.publicarFeed(texto, imagemUrl);

    if (error) {
      console.error(error);
      if (imagemUrl) {
        void this.supabase.removerImagem(imagemUrl);
      }
      this.enviando = false;
      this.toast.erro('Não foi possível publicar a atualização');
      return;
    }

    this.conteudo = '';
    this.imagemArquivo = null;
    // O seletor do composer não é destruído ao publicar, então a prévia é
    // liberada por aqui; sem isso a foto antiga continuava na tela.
    this.seletorImagem?.limpar();
    this.enviando = false;
    this.toast.sucesso('Atualização publicada');
    await this.carregar();
  }

  /**
   * "agora", "há 5 min", "há 2 h", "há 3 d" — mede quando o post foi criado,
   * não quando o evento acontece.
   *
   * Passar a data do evento aqui dava "agora" em todo card: o mural só traz
   * eventos futuros, então a diferença para agora seria negativa e cairia no
   * primeiro `if`. A data do evento é mostrada por `dataEvento`, no corpo do
   * post.
   */
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

  /**
   * Data e hora do evento no corpo do card: "hoje, 19:30", "amanhã, 19:30"
   * ou "12/05, 19:30".
   */
  dataEvento(iso: string): string {
    const data = new Date(iso);
    if (isNaN(data.getTime())) return '';

    const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const hoje = new Date();

    // Comparação por calendário, não por diferença de timestamp: somar 24 h
    // em ms erra o dia em horário de verão.
    const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    if (inicioDoDia(data) === inicioDoDia(hoje)) return `hoje, ${hora}`;

    const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
    if (inicioDoDia(data) === inicioDoDia(amanha)) return `amanhã, ${hora}`;

    // O ano só aparece quando é outro, para não repetir a cada card.
    const mesmoAno = data.getFullYear() === hoje.getFullYear();
    const dia = data.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      ...(mesmoAno ? {} : { year: 'numeric' })
    });

    return `${dia}, ${hora}`;
  }

  /** Data por extenso para o tooltip do timestamp do evento. */
  dataCompleta(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR');
  }
}
