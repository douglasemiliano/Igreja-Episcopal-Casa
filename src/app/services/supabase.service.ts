import { inject, Injectable } from '@angular/core';
import {
  AuthChangeEvent,
  createClient,
  Session,
  SupabaseClient,
  User
} from '@supabase/supabase-js';
import { environment } from '../../environments/environments.development';
import { LoadingService } from './loading.service'; // Importando seu serviço de loading

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  public supabase: SupabaseClient;

  private loadingService: LoadingService = inject(LoadingService);

  constructor() {
    this.supabase = createClient(
      environment.SUPABASE_URL,
      environment.SUPABASE_KEY,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storage: localStorage,
        },
        global: {
          // Modificando o fetch global para interceptar as requisições
          fetch: async (...args) => {
            this.loadingService.show(); // Exibe o loading quando a requisição for feita

            try {
              const response = await fetch(...args); // Chama o fetch normalmente
              return response;
            } catch (error) {
              console.error("Erro no fetch:", error);
              throw error;
            } finally {
              this.loadingService.hide(); // Esconde o loading quando a requisição terminar
            }
          },
        },
      }
    );
  }

  insertLectionary(entry: any) {
    return this.supabase.from('lecionario').insert([entry]);
  }

  getLectionary() {
    return this.supabase.from('lecionario').select('*').eq('ano_liturgico', 'C');
  }

  getLecionarioPorAnoLiturgico(ano_liturgico: string) {
    return this.supabase.from('lecionario').select('*').eq('ano_liturgico', ano_liturgico).order('dia', { ascending: true });
  }
  
  getLecionarioPorData(data: Date) {
    let dataString = this.formatDate(data);    
    return this.supabase.from('lecionario').select('*').eq('dia', dataString);
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString("pt-BR").split('/').reverse().join('-');
  }

  async getTodosLectionary() {
    return this.supabase.from('lecionario').select('*');
  }

  signUp(email: string, password: string) {
    return this.supabase.auth.signUp({ email, password });
  }

  signIn(email: string, password: string) {
    return this.supabase.auth.signInWithPassword({ email, password });
  }

  signOut() {
    return this.supabase.auth.signOut();
  }

  getSession() {
    return this.supabase.auth.getSession();
  }

  /**
   * Provedor do login atual.
   * Senha só pode ser alterada em login por senha: contas do Google
   * não têm senha local e a troca falharia.
   */
  async getAuthProvider(): Promise<string | null> {
    const user = await this.getUser();
    return user?.app_metadata?.['provider'] ?? null;
  }

  async loginComSenha(): Promise<boolean> {
    return (await this.getAuthProvider()) !== 'google';
  }

  // --- PERFIL / AVATAR ---

  private get extensaoValida(): string[] {
    return ['jpg', 'jpeg', 'png', 'webp'];
  }

  /**
   * Redimensiona e recomprime a imagem no navegador antes do upload.
   *
   * Foto de celular costuma ter 3-8 MB; um avatar de 512px em JPEG fica
   * na casa das dezenas de KB. Reduzir no cliente economiza banda do
   * usuário e cota de egress, já que o bucket é público.
   */
  private async compactarImagem(
    arquivo: File,
    ladoMaximo = 512,
    qualidade = 0.82
  ): Promise<File> {
    // SVG/animados não passam pelo canvas
    if (!arquivo.type.startsWith('image/') || arquivo.type === 'image/svg+xml') {
      throw new Error('Formato não suportado para compactação.');
    }

    const url = URL.createObjectURL(arquivo);

    try {
      const imagem = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
        img.src = url;
      });

      const escala = Math.min(1, ladoMaximo / Math.max(imagem.width, imagem.height));
      const largura = Math.max(1, Math.round(imagem.width * escala));
      const altura = Math.max(1, Math.round(imagem.height * escala));

      const canvas = document.createElement('canvas');
      canvas.width = largura;
      canvas.height = altura;

      const contexto = canvas.getContext('2d');
      if (!contexto) return arquivo;

      contexto.imageSmoothingQuality = 'high';
      // JPEG não tem alpha: fundo branco evita área preta em PNGs transparentes
      contexto.fillStyle = '#ffffff';
      contexto.fillRect(0, 0, largura, altura);
      contexto.drawImage(imagem, 0, 0, largura, altura);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', qualidade)
      );

      if (!blob) return arquivo;

      const compactado = new File([blob], 'avatar.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now()
      });

      // Se a compactação não ajudou (imagem já pequena), manda o original
      return compactado.size < arquivo.size ? compactado : arquivo;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Envia o avatar para `avatars/<user_id>/<arquivo>` e grava a URL em
   * `user_metadata.avatar_url` (o header e o mural leem a metadata).
   */
  async uploadAvatar(arquivo: File): Promise<{ url: string } | { erro: string }> {
    const user = await this.getUser();
    if (!user) return { erro: 'Sessão expirada. Faça login novamente.' };

    const extensao = arquivo.name.split('.').pop()?.toLowerCase() ?? '';
    if (!this.extensaoValida.includes(extensao)) {
      return { erro: 'Formato inválido. Use JPG, PNG ou WEBP.' };
    }
    if (arquivo.size > 10 * 1024 * 1024) {
      return { erro: 'A imagem deve ter no máximo 10 MB.' };
    }

    let otimizado = arquivo;
    try {
      otimizado = await this.compactarImagem(arquivo);
    } catch (erro) {
      console.error(erro);
      return { erro: 'Não foi possível preparar a imagem para envio.' };
    }

    const extensaoFinal = otimizado === arquivo ? extensao : 'jpg';
    const caminho = `${user.id}/avatar.${extensaoFinal}`;

    const { error: erroUpload } = await this.supabase.storage
      .from('avatars')
      .upload(caminho, otimizado, { upsert: true, contentType: otimizado.type });

    if (erroUpload) {
      console.error(erroUpload);
      return { erro: 'Não foi possível enviar a imagem.' };
    }

    const { data: url } = this.supabase.storage.from('avatars').getPublicUrl(caminho);

    // Apaga versões anteriores (ex.: avatar.png depois do avatar.jpg),
    // senão cada troca de formato deixa lixo ocupando cota.
    await this.removerAvataresAntigos(user.id, caminho);

    // A policy de update em profiles só abre para admin/pastor, então o
    // usuário comum vincula a foto pela metadata do auth e pela função
    // security definer que escreve em profiles.foto (lido no mural).
    const { error: erroMeta } = await this.supabase.auth.updateUser({
      data: { avatar_url: url.publicUrl }
    });

    if (erroMeta) {
      console.error(erroMeta);
      return { erro: 'Imagem enviada, mas não foi possível vincular ao perfil.' };
    }

    const { error: erroPerfil } = await this.supabase.rpc('atualizar_meu_foto', {
      nova_foto: url.publicUrl
    });

    if (erroPerfil) {
      console.error(erroPerfil);
      return { erro: 'Foto atualizada, mas não foi possível sincronizar o perfil.' };
    }

    return { url: url.publicUrl };
  }

  /**
   * Remove arquivos de avatar do usuário que não sejam o caminho atual.
   * Só considera a própria pasta, então não há risco de apagar a foto
   * de outra pessoa. Falha silenciosa: é limpeza, não operação crítica.
   */
  private async removerAvataresAntigos(userId: string, caminhoAtual: string): Promise<void> {
    try {
      const { data: arquivos, error } = await this.supabase.storage
        .from('avatars')
        .list(userId, { limit: 100 });

      if (error || !arquivos?.length) return;

      const obsoletos = arquivos
        .filter((arquivo) => arquivo.name !== caminhoAtual.split('/').pop())
        .map((arquivo) => `${userId}/${arquivo.name}`);

      if (!obsoletos.length) return;

      await this.supabase.storage.from('avatars').remove(obsoletos);
    } catch {
      // limpeza best-effort
    }
  }

  /**
   * Nome de exibição: metadata (auth) + profiles.nome (listas e mural).
   *
   * A policy de `profiles` só abre update para admin/pastor, então o
   * próprio usuário grava via função security definer.
   */
  async atualizarNome(nome: string): Promise<{ erro: string | null }> {
    const user = await this.getUser();
    if (!user) return { erro: 'Sessão expirada. Faça login novamente.' };

    const { error: erroMeta } = await this.supabase.auth.updateUser({
      data: { name: nome, full_name: nome }
    });

    if (erroMeta) {
      console.error(erroMeta);
      return { erro: 'Não foi possível atualizar o nome.' };
    }

    const { error: erroPerfil } = await this.supabase.rpc('atualizar_meu_nome', { novo_nome: nome });

    if (erroPerfil) {
      console.error(erroPerfil);
      return { erro: 'Nome atualizado, mas o cadastro não foi sincronizado.' };
    }

    return { erro: null };
  }

  /** Troca de senha. `novaSenha` precisa ter no mínimo 6 caracteres. */
  async atualizarSenha(novaSenha: string): Promise<{ erro: string | null }> {
    if (novaSenha.length < 6) {
      return { erro: 'A nova senha deve ter no mínimo 6 caracteres.' };
    }

    const { error } = await this.supabase.auth.updateUser({ password: novaSenha });

    if (error) {
      console.error(error);
      return { erro: 'Não foi possível alterar a senha.' };
    }

    return { erro: null };
  }

    // Login com Google
signInWithGoogle() {
  return this.supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Usando template string para garantir a rota /dashboard correta
      redirectTo: `${environment.REDIRECT_URL}/dashboard` 
    }
  });
}



  onAuthChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    this.supabase.auth.onAuthStateChange((_event, session) => {
      callback(_event, session);
    });
  }

  /**
   * Usuário logado, ou null.
   *
   * Nunca rejeita: o SDK usa `navigator.locks` para proteger o token de auth
   * e, com múltiplas abas do app abertas, o lock pode falhar
   * (NavigatorLockAcquireTimeoutError). Nesse caso caímos na sessão local,
   * que é suficiente para checagens de UI, em vez de derrubar a tela.
   */
  async getUser(): Promise<User | null> {
    try {
      const { data, error } = await this.supabase.auth.getUser();
      if (error || !data?.user) return null;
      return data.user;
    } catch (erro) {
      console.warn('Falha ao consultar o usuário autenticado:', erro);
      try {
        const { data } = await this.supabase.auth.getSession();
        return data?.session?.user ?? null;
      } catch {
        return null;
      }
    }
  }

  getUserResult() {
    return this.supabase.auth.getUser();
  }

  updateLectionary(id: number, entry: any) {
    return this.supabase
      .from('lecionario')
      .update(entry)
      .eq('id', id);
  }

  deleteLectionary(id: string) {
    return this.supabase
      .from('lecionario')
      .delete()
      .eq('id', id);
  }

  // Listar todos os membros
getMembros() {
  return this.supabase.from('membros').select('*').order('nome_completo', { ascending: true });
}

getMembrosComConfirmacao() {
  return this.supabase
    .from('membros')
    .select(`
      *,
      confirmacao:confirmacoes_membros (
        *
      )
    `)
    .order('nome_completo', { ascending: true });
}


// Adicionar membro
addMembro(membro: any) {
  return this.supabase.from('membros').insert([membro]);
}

// Atualizar membro
updateMembro(id: string, membro: any) {
  return this.supabase.from('membros').update(membro).eq('id', id);
}

// Deletar membro
deleteMembro(id: string) {
  return this.supabase.from('membros').delete().eq('id', id);
}

// --- CONFIRMAÇÕES ---

// Registrar confirmação
confirmarMembro(membro_id: string, dadosConfirmacao: any) {
  const confirmacao = { membro_id, ...dadosConfirmacao };
  return this.supabase.from('confirmacoes_membros').insert([confirmacao]);
}

// Listar confirmações de um membro
getConfirmacoesPorMembro(membro_id: string) {
  return this.supabase
    .from('confirmacoes_membros')
    .select('*')
    .eq('membro_id', membro_id)
    .order('data_confirmacao', { ascending: true });
}

getConfirmacoes() {
  return this.supabase.from('confirmacoes_membros').select('*');
}

getMembro(id: string) {
  return this.supabase.from('membros').select('*').eq('id', id).single();
}

getHistoricoMembro(id: string) {
  return Promise.all([
    this.supabase.from('confirmacoes_membros').select('*').eq('membro_id', id).order('data_confirmacao', { ascending: false }),
    this.supabase.from('vendas_arrecadacao').select('*, itens:itens_venda_arrecadacao(*)').eq('membro_id', id).order('data_venda', { ascending: false }),
    this.supabase.from('registros_batismo').select('*').eq('membro_id', id)
  ]);
}

getAgenda(filtros: { inicio?: string; fim?: string } = {}) {
  let query = this.supabase.from('agenda_igreja').select('*').order('inicio', { ascending: true });
  if (filtros.inicio) query = query.gte('inicio', filtros.inicio);
  if (filtros.fim) query = query.lte('inicio', filtros.fim);
  return query;
}

/** Eventos que ainda não aconteceram, para exibir no mural. */
getProximosEventos(limite = 5) {
  return this.supabase
    .from('agenda_igreja')
    .select('id, titulo, tipo, inicio, local, responsaveis, observacoes')
    .gte('inicio', new Date().toISOString())
    .order('inicio', { ascending: true })
    .limit(limite);
}

addAgenda(evento: any) {
  return this.supabase.from('agenda_igreja').insert([evento]).select().single();
}

updateAgenda(id: string, evento: any) {
  return this.supabase.from('agenda_igreja').update(evento).eq('id', id).select().single();
}

deleteAgenda(id: string) {
  return this.supabase.from('agenda_igreja').delete().eq('id', id);
}

/** Todas as roles do usuário. Nunca retorna lista vazia (fallback: membro). */
async getRoles(): Promise<string[]> {
  const user = await this.getUser();
  if (!user) return ['membro'];

  const { data } = await this.supabase
    .from('profiles')
    .select('roles')
    .eq('id', user.id)
    .maybeSingle();

  const fromPerfil: string[] = Array.isArray(data?.roles) ? data.roles : [];
  const fromMetadata: string[] = Array.isArray(user.user_metadata?.['roles'])
    ? user.user_metadata['roles']
    : user.user_metadata?.['role']
      ? [user.user_metadata['role']]
      : [];

  const roles = [...fromPerfil, ...fromMetadata]
    .map((role) => (role === 'leitor' ? 'membro' : role)) // perfil antigo
    .filter((role, indice, lista) => lista.indexOf(role) === indice);

  return roles.length ? roles : ['membro'];
}

/** Roles conhecidas pelo sistema, em ordem de permissão. */
readonly rolesDisponiveis = [
  'administrador',
  'secretaria',
  'caixa',
  'tesouraria',
  'pastor',
  'lider',
  'membro'
];

/** Verifica se o usuário tem ao menos uma das roles informadas. */
async temAlgumaRole(roles: string[]): Promise<boolean> {
  if (!roles.length) return true;
  const minhas = await this.getRoles();
  return roles.some((role) => minhas.includes(role));
}

listUsuarios() {
  return this.supabase
    .from('profiles')
    .select('id, roles, nome, email, criado_em, atualizado_em')
    .order('nome', { ascending: true });
}

atualizarRolesUsuario(id: string, roles: string[]) {
  return this.supabase
    .from('profiles')
    .update({ roles, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
}

// --- FEED / MURAL ---

getFeed() {
  return this.supabase
    .from('feed_publicacoes')
    .select(`
      id,
      conteudo,
      criado_em,
      atualizado_em,
      autor_id,
      autor:profiles!feed_publicacoes_autor_id_fkey(id, nome, roles, email, foto)
    `)
    .order('criado_em', { ascending: false });
}

async publicarFeed(conteudo: string) {
  const user = await this.getUser();
  if (!user) return { data: null, error: { message: 'Sessão expirada.' } as any };
  return this.supabase
    .from('feed_publicacoes')
    .insert({ conteudo: conteudo.trim(), autor_id: user.id })
    .select()
    .single();
}

editarFeed(id: string, conteudo: string) {
  return this.supabase
    .from('feed_publicacoes')
    .update({ conteudo: conteudo.trim() })
    .eq('id', id)
    .select()
    .single();
}

excluirFeed(id: string) {
  return this.supabase.from('feed_publicacoes').delete().eq('id', id);
}

// --- ARRECADACOES ---

getVendasArrecadacao() {
  return this.supabase
    .from('vendas_arrecadacao')
    .select(`
      *,
      membro:membros(id, nome_completo),
      itens:itens_venda_arrecadacao(*)
    `)
    .order('data_venda', { ascending: false });
}

async criarVendaArrecadacao(venda: any, itens: any[]) {
  const { data: vendaCriada, error: vendaError } = await this.supabase
    .from('vendas_arrecadacao')
    .insert([venda])
    .select()
    .single();

  if (vendaError || !vendaCriada) {
    return { data: null, error: vendaError };
  }

  const itensComVenda = itens.map((item) => ({
    ...item,
    venda_id: vendaCriada.id
  }));

  const { error: itensError } = await this.supabase
    .from('itens_venda_arrecadacao')
    .insert(itensComVenda);

  if (itensError) {
    await this.supabase.from('vendas_arrecadacao').delete().eq('id', vendaCriada.id);
    return { data: null, error: itensError };
  }

  return { data: vendaCriada, error: null };
}

async removerItemArrecadacao(itemId: string, vendaId: string, totalRestante: number) {
  const { error: itemError } = await this.supabase
    .from('itens_venda_arrecadacao')
    .delete()
    .eq('id', itemId);

  if (itemError) {
    return { error: itemError };
  }

  if (totalRestante <= 0) {
    return this.supabase.from('vendas_arrecadacao').delete().eq('id', vendaId);
  }

  return this.supabase
    .from('vendas_arrecadacao')
    .update({ total: totalRestante, atualizado_em: new Date().toISOString() })
    .eq('id', vendaId);
}

  marcarVendaArrecadacaoComoPaga(id: string, formaPagamento: 'pix' | 'debito' | 'credito' | 'dinheiro') {
  return this.supabase
    .from('vendas_arrecadacao')
    .update({
      status: 'pago',
      forma_pagamento: formaPagamento,
      data_pagamento: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    })
    .eq('id', id);
}

async getCaixaAberto() {
  return this.supabase
    .from('caixas')
    .select('*')
    .eq('status', 'aberto')
    .maybeSingle();
}

async getCaixasFechadas() {
  return this.supabase
    .from('caixas')
    .select('*')
    .eq('status', 'fechado')
    .order('fechado_em', { ascending: false });
}

async getCaixas({ inicio, fim }: { inicio: string; fim: string }) {
  return this.supabase
    .from('caixas')
    .select('*')
    .gte('aberto_em', inicio)
    .lt('aberto_em', fim)
    .order('aberto_em', { ascending: true });
}

async getTodasCaixas() {
  return this.supabase
    .from('caixas')
    .select('*')
    .order('aberto_em', { ascending: true });
}


async abrirCaixa(valorAbertura: number, observacoes: string | null) {
  return this.supabase.rpc('abrir_caixa', {
    p_valor_abertura: valorAbertura,
    p_observacoes: observacoes
  });
}

async fecharCaixa(valorFechamento: number, observacoes: string | null) {
  return this.supabase.rpc('fechar_caixa', {
    p_valor_fechamento: valorFechamento,
    p_observacoes: observacoes
  });
}

}