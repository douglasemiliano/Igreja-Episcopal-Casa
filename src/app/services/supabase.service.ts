import { inject, Injectable } from '@angular/core';
import {
  AuthChangeEvent,
  createClient,
  PostgrestError,
  Session,
  SupabaseClient,
  User
} from '@supabase/supabase-js';
// O build de desenvolvimento substitui este arquivo pelo
// environments.development.ts (fileReplacements em angular.json). Importar o
// de desenvolvimento direto aqui fazia o bundle de production apontar para
// localhost.
import { environment } from '../../environments/environments';
import { LoadingService } from './loading.service'; // Importando seu serviço de loading
import {
  DadosCompletarCadastro,
  DadosPerfilMembro,
  MembroVinculo,
  normalizarStatus,
  PreviaExclusao,
  ResultadoExclusaoMembro,
  ResultadoOperacao,
  StatusVinculoResposta,
} from '../model/membro.model';

/**
 * Teto do arquivo escolhido pelo usuário, antes da compactação.
 *
 * Não é o tamanho que chega ao bucket: a foto da publicação é sempre
 * reencodeada para 1280px, então o enviado costuma ficar abaixo de 500 KB.
 * Esse teto existe só para não tentar decodificar um arquivo absurdo, e é
 * Generoso de propósito — foto de celular moderno passa fácil de 10 MB, e
 * recusar no front só faria o usuário trocar de foto à toa.
 */
export const TAMANHO_MAXIMO_IMAGEM_MB = 60;

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
   *
   * `sempreCompactar` inverte a escolha do fim: em vez de devolver o
   * original quando a reencode não ajudou, devolve o JPEG e falha se não
   * conseguir. É o que a foto da publicação usa, para que o bucket nunca
   * receba um arquivo que não passou pelo canvas.
   */
  private async compactarImagem(
    arquivo: File,
    ladoMaximo = 512,
    qualidade = 0.82,
    sempreCompactar = false
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
      if (!contexto) {
        if (sempreCompactar) throw new Error('Canvas 2D indisponível.');
        return arquivo;
      }

      contexto.imageSmoothingQuality = 'high';
      // JPEG não tem alpha: fundo branco evita área preta em PNGs transparentes
      contexto.fillStyle = '#ffffff';
      contexto.fillRect(0, 0, largura, altura);
      contexto.drawImage(imagem, 0, 0, largura, altura);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', qualidade)
      );

      if (!blob) {
        if (sempreCompactar) throw new Error('Não foi possível codificar a imagem.');
        return arquivo;
      }

      const compactado = new File([blob], 'imagem.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now()
      });

      if (sempreCompactar) return compactado;

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
  //
  // O redirect vai para /home e nao para /dashboard de proposito: /dashboard
  // exige a chave ver_dashboard, e quem nao tem caia num redirect do
  // PermissaoGuard para /home sem nenhuma explicacao. Assumindo /home, quem
  // precisa de outra coisa e levado pelo CadastroGuard, que sabe o motivo.
  signInWithGoogle() {
    // Barra final no REDIRECT_URL viraria barra dupla na concatenacao.
    const base = environment.REDIRECT_URL.replace(/\/+$/, '');
    return this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${base}/home`
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

  // --------------------------------------------------------------------------
  // Vinculo entre a conta de login e o registro em membros.
  //
  // Estas tres funcoes sao SECURITY DEFINER no banco (20260927_vincular_membros.sql).
  // Nao ha policy de INSERT em membros para o proprio usuario de proposito: a
  // escrita passa pela funcao, que so aceita mexer na linha apontada pelo
  // user_id do proprio auth.uid().
  // --------------------------------------------------------------------------

  /**
   * Idempotente. Procura membro pelo email normalizado e, se nao achar,
   * abre um pre-cadastro. Chamar em toda navegacao nao faz mal.
   */
  async entrarNoMembro(): Promise<StatusVinculoResposta> {
    const { data, error } = await this.supabase.rpc('entrar_no_membro');
    if (error) {
      return { status: 'erro', mensagem: 'Não foi possível verificar seu cadastro.' };
    }

    const resposta = normalizarStatus(data);

    /*
     * `verificado` chega como timestamptz, e portanto como TEXTO
     * ("2026-09-28T01:30:00+00:00"), não como booleano. A tela de cadastro
     * compara com `!== true`, então uma string não Null — mesmo já preenchida
     * — contava como "nunca conferiu". O efeito era um laço sem saída: a
     * pessoa concluía, o banco gravava o carimbo, e o guard a devolvia para a
     * mesma tela, porque o carimbo era lido no formato errado.
     *
     * Traduzir aqui, e não no consumidor, porque a regra "o que o front precisa
     * é um sim ou não" vale para toda chamada. `meuMembro` faz o mesmo.
     */
    const bruto = resposta as StatusVinculoResposta & { verificado?: string | boolean | null };

    return {
      ...resposta,
      verificado: !!bruto.verificado,
    };
  }

  /** Leitura pura do membro ligado a conta atual. Nao cria nem altera nada. */
  async meuMembro(): Promise<MembroVinculo> {
    const { data, error } = await this.supabase.rpc('meu_membro');
    if (error) {
      return { existe: false, completo: false };
    }
    const bruto = (data ?? { existe: false, completo: false }) as MembroVinculo & {
      verificado?: string | null;
    };
    return {
      ...bruto,
      // O banco devolve timestamptz. O que o front precisa saber e so se a
      // tela ja foi vista, entao a data vira booleano aqui.
      verificado: !!bruto.verificado,
    };
  }

  /**
   * Sai da tela sem preencher. Carimba a marca do mesmo jeito, senao ela volta
   * no proximo login. O registro em si nao e tocado.
   */
  async pularAtualizacaoCadastral(): Promise<ResultadoOperacao> {
    const { data, error } = await this.supabase.rpc('pular_atualizacao_cadastral');
    if (error) {
      return { status: 'erro' };
    }
    return (data ?? { status: 'erro' }) as ResultadoOperacao;
  }

  /** Fecha o pre-cadastro. Chamar completarMeuCadastro quando a pessoa envia. */
  async completarMeuCadastro(dados: DadosCompletarCadastro): Promise<ResultadoOperacao> {
    const { data, error } = await this.supabase.rpc('completar_meu_cadastro', {
      p_nome: dados.nome ?? null,
      p_telefone: dados.telefone ?? null,
      p_data_nascimento: dados.dataNascimento || null,
      p_sexo: dados.sexo ?? null,
      p_endereco: dados.endereco ?? null,
      p_funcao: dados.funcao ?? null,
    });

    if (error) {
      return { status: 'erro', mensagem: 'Não foi possível salvar seu cadastro.' };
    }
    return (data ?? { status: 'erro', mensagem: 'Resposta inesperada do banco.' }) as ResultadoOperacao;
  }

  /**
   * Grava a edição do perfil em `membros`.
   *
   * Não passa por `atualizarNome`, que escreve em `profiles`: o perfil passou a
   * ser o cadastro do membro, e o nome da conta é só o espelho que o cabeçalho
   * consome. `sem_vinculo` é um estado esperado, não uma falha — devolve
   * quem entrou no app sem ter conta na lista de membros.
   */
  async atualizarMeuPerfil(dados: DadosPerfilMembro): Promise<ResultadoOperacao> {
    const { data, error } = await this.supabase.rpc('atualizar_meu_perfil', {
      p_nome: dados.nome ?? null,
      p_telefone: dados.telefone ?? null,
      p_data_nascimento: dados.dataNascimento || null,
      p_sexo: dados.sexo ?? null,
      p_endereco: dados.endereco ?? null,
      p_funcao: dados.funcao ?? null,
    });

    if (error) {
      return { status: 'erro', mensagem: 'Não foi possível salvar o perfil.' };
    }

    const bruto = (data ?? { status: 'erro', mensagem: 'Resposta inesperada do banco.' }) as {
      status: ResultadoOperacao['status'];
      id?: string | null;
      perfil_sincronizado?: boolean;
      mensagem?: string;
    };

    return {
      status: bruto.status,
      id: bruto.id,
      perfilSincronizado: bruto.perfil_sincronizado,
      mensagem: bruto.mensagem,
    };
  }

  /**
   * Previa do que a exclusão vai apagar, para o modal montar a confirmação.
   * Não escreve nada.
   */
  async previaExclusaoMembro(id: string): Promise<PreviaExclusao> {
    const { data, error } = await this.supabase
      .from('membros')
      .select('id, nome_completo, user_id')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      return { temConta: false, publicacoes: 0 };
    }

    if (!data.user_id) {
      return { temConta: false, publicacoes: 0, nome: data.nome_completo };
    }

    const { count } = await this.supabase
      .from('feed_publicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('autor_id', data.user_id);

    return { temConta: true, publicacoes: count ?? 0, nome: data.nome_completo };
  }

  /**
   * Exclui o membro e derruba a conta dele.
   *
   * Não dá para fazer pelo `auth.admin.deleteUser()`: a SUPABASE_KEY do bundle
   * é a chave `anon`, e apagar usuário exige `service_role`. A escrita em
   * auth.users acontece dentro de `excluir_membro_e_conta`, SECURITY DEFINER,
   * que revalida `public.pode('excluir_membros')` a cada chamada — ou seja,
   * esconder o botão na interface não é a proteção.
   */
  async excluirMembroEConta(id: string): Promise<ResultadoExclusaoMembro> {
    const { data, error } = await this.supabase.rpc('excluir_membro_e_conta', {
      p_membro_id: id,
    });

    if (error) {
      // Registra o erro inteiro, e não só o "não foi possível". A função
      // devolve jsonb com `mensagem` em todos os caminhos de erro que ela
      // controla — permissão, membro inexistente, conta própria — e nenhum
      // deles chega aqui como `error`. Então um `error` significa que o
      // PostgREST recusou a CHAMADA, antes do corpo rodar: cache de schema
      // velho, assinatura diferente, ou execute revogado. Sem este log, a tela
      // mostra "Não foi possível excluir o membro" e a causa morre aqui.
      console.error('[membros] excluir_membro_e_conta falhou:', error.code, error.message, error.details);

      return {
        status: 'erro',
        mensagem: this.mensagemDeErroPostgRest(error),
      };
    }
    return (data ?? { status: 'erro', mensagem: 'Resposta inesperada do banco.' }) as ResultadoExclusaoMembro;
  }

  /**
   * Traduz um `error` do PostgREST numa frase que a pessoa entende e que
   * serve de diagnóstico.
   *
   * A função devolve `status: 'erro'` com mensagem própria em todo caminho que
   * ela controla, então um `error` aqui é sempre o PostgREST recusando a
   * chamada antes do corpo rodar. A mensagem que ele devolve NÃO é texto para
   * o usuário final — é o diagnóstico. "Could not find the function
   * public.excluir_membro_e_conta(p_membro_id) in the schema cache" diz
   * exatamente o que está errado de um jeito que "Não foi possível excluir o
   * membro" esconde, e era por isso que o 400 sumia sem deixar rastro.
   *
   * As duas exceções continuam amigáveis: falta de permissão (42501) e sessão
   * ausente são situações previstas, com tradução própria.
   */
  private mensagemDeErroPostgRest(error: PostgrestError): string {
    const bruto = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;

    if (bruto.includes('42501')) {
      return 'Você não tem permissão para excluir membros.';
    }
    if (bruto.includes('JWT') || bruto.includes('token')) {
      return 'Sessão ausente ou expirada. Entre novamente.';
    }

    const detalhe = [error.code, error.message, error.hint].filter(Boolean).join(' — ');
    return detalhe
      ? `Não foi possível excluir o membro. Detalhe do banco: ${detalhe}`
      : 'Não foi possível excluir o membro.';
  }

/*
 * Removido: `deleteMembro(id)`, que fazia `from('membros').delete()` direto.
 *
 * A exclusão passou por `excluirMembroEConta`. Deixar o caminho antigo vivo
 * seria uma armadilha: apagava o registro e mantinha a conta, e na volta ao
 * login `entrar_no_membro` não encontraria o e-mail em nenhum membro e abriria
 * um pre-cadastro novo — a pessoa sairia da lista e voltaria sozinha.
 */

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

/**
 * Foto do membro pelo `user_id` (id da conta/auth) dele.
 *
 * `membros` não guarda foto: o avatar mora em `profiles.foto`, e o vínculo é
 * `membros.user_id = profiles.id`. A policy de leitura de `profiles` é
 * `using (true)` para autenticados (20260925_roles_multiplas_e_feed.sql), então
 * o perfil de qualquer membro pode mostrar a foto. Devolve null/com vazio
 * quando a pessoa nunca enviou avatar — quem monta o perfil cai no fallback de
 * iniciais.
 */
async getFotoMembro(userId: string): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await this.supabase
    .from('profiles')
    .select('foto')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[membros] getFotoMembro falhou:', error.code, error.message);
    return null;
  }
  const foto = (data as { foto?: string | null } | null)?.foto;
  return foto || null;
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
      .select('id, titulo, tipo, inicio, local, responsaveis, observacoes, imagem_url, criado_em')
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

// --- PERMISSÕES DINÂMICAS ---
/**
 * Capacidades do usuário corrente, resolvidas no banco por public.pode().
 *
 * É a mesma função que as policies consultam, então o conjunto que volta aqui
 * e o que o banco aceita são o mesmo por construção — não duas listas que
 * precisam concordar.
 *
 * Ver docs/permissoes-dinamicas-plano.md e
 * supabase/20260927_permissoes_dinamicas.sql.
 */
async minhasPermissoes(): Promise<string[]> {
  const { data, error } = await this.supabase.rpc('minhas_permissoes');
  if (error) throw error;
  return Array.isArray(data) ? (data as string[]) : [];
}

/**
 * Catálogo e concessões, para a tela de permissões do administrador.
 *
 * Uma chamada só porque as duas tabelas têm nome diferente; a tela monta o
 * cruzamento de chave x papel.
 */
async carregarMatrizPermissoes(): Promise<{ catalogo: any[]; concessoes: any[] }> {
  const [catalogo, concessoes] = await Promise.all([
    this.supabase
      .from('permissoes')
      .select('chave, rotulo, descricao, categoria, ordenacao, reservada')
      .order('ordenacao', { ascending: true }),
    this.supabase.from('permissoes_roles').select('chave, role')
  ]);

  if (catalogo.error) throw catalogo.error;
  if (concessoes.error) throw concessoes.error;

  return {
    catalogo: catalogo.data ?? [],
    concessoes: concessoes.data ?? []
  };
}

/** Concede uma capacidade a um papel. Regra nova, não há id para revogar. */
async concederPermissao(chave: string, role: string): Promise<void> {
  const { error } = await this.supabase.rpc('conceder_permissao', {
    alvo_chave: chave,
    alvo_role: role
  });
  if (error) throw error;
}

async revogarPermissao(chave: string, role: string): Promise<void> {
  const { error } = await this.supabase.rpc('revogar_permissao', {
    alvo_chave: chave,
    alvo_role: role
  });
  if (error) throw error;
}

/** Rastro de quem alterou qual permissão. Só o administrador enxerga. */
async carregarAuditoriaPermissoes(limite = 50): Promise<any[]> {
  const { data, error } = await this.supabase
    .from('permissoes_auditoria')
    .select('chave, role, operacao, feito_por, feito_em')
    .order('feito_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data ?? [];
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
      imagem_url,
      criado_em,
      atualizado_em,
      autor_id,
      autor:profiles!feed_publicacoes_autor_id_fkey(id, nome, roles, email, foto)
    `)
    .order('criado_em', { ascending: false });
}

async publicarFeed(conteudo: string, imagemUrl?: string | null) {
  const user = await this.getUser();
  if (!user) return { data: null, error: { message: 'Sessão expirada.' } as any };
  return this.supabase
    .from('feed_publicacoes')
    .insert({
      conteudo: conteudo.trim(),
      autor_id: user.id,
      imagem_url: imagemUrl ?? null
    })
    .select()
    .single();
}

/**
 * `imagemUrl` undefined não mexe na coluna; null limpa a foto.
 * Quem chama decide, porque trocar (null) e manter (undefined) são operações
 * diferentes quando o post já tinha imagem.
 */
editarFeed(id: string, conteudo: string, imagemUrl?: string | null) {
  const mudancas: Record<string, unknown> = { conteudo: conteudo.trim() };
  if (imagemUrl !== undefined) {
    mudancas['imagem_url'] = imagemUrl;
  }
  return this.supabase.from('feed_publicacoes').update(mudancas).eq('id', id).select().single();
}

excluirFeed(id: string) {
  return this.supabase.from('feed_publicacoes').delete().eq('id', id);
}

// --- FOTO DA PUBLICAÇÃO E DO EVENTO ---
  /** Foto da publicação do feed. */
  async enviarImagemPostagem(arquivo: File): Promise<{ url: string } | { erro: string }> {
    return this.enviarFotoParaBucket(arquivo, '');
  }

  /**
   * Foto do evento. O prefixo separa os dois arquivos na mesma pasta do
   * usuário: `postagens/<id>/evento-<aleatorio>.jpg`.
   */
  async enviarImagemEvento(arquivo: File): Promise<{ url: string } | { erro: string }> {
    return this.enviarFotoParaBucket(arquivo, 'evento-');
  }

  /**
   * Envia a foto para `postagens/<user_id>/<prefixo><aleatorio>.<ext>` e devolve
   * a URL pública. O nome tem sufixo aleatório porque a foto pode ser trocada
   * várias vezes e sobrescrever a anterior quebraria o cache do navegador.
   *
   * O teto de tamanho vale para o arquivo escolhido; o que sobe é sempre o
   * JPEG reduzido pelo canvas, então a imagem nunca chega ao bucket no
   * tamanho original.
   */
  private async enviarFotoParaBucket(
    arquivo: File,
    prefixo: string
  ): Promise<{ url: string } | { erro: string }> {
    const user = await this.getUser();
    if (!user) return { erro: 'Sessão expirada. Faça login novamente.' };

    const extensao = arquivo.name.split('.').pop()?.toLowerCase() ?? '';
    if (!this.extensaoValida.includes(extensao)) {
      return { erro: 'Formato inválido. Use JPG, PNG ou WEBP.' };
    }
    if (arquivo.size > TAMANHO_MAXIMO_IMAGEM_MB * 1024 * 1024) {
      return { erro: `A imagem deve ter no máximo ${TAMANHO_MAXIMO_IMAGEM_MB} MB.` };
    }

    let otimizado: File;
    try {
      // 1280px: largura suficiente para celular e desktop sem estourar a cota.
      otimizado = await this.compactarImagem(arquivo, 1280, 0.85, true);
    } catch (erro) {
      console.error(erro);
      return { erro: 'Não foi possível preparar a imagem para envio.' };
    }

    const caminho = `${user.id}/${prefixo}${this.idAleatorio()}.jpg`;

    const { error: erroUpload } = await this.supabase.storage
      .from('postagens')
      .upload(caminho, otimizado, { upsert: false, contentType: otimizado.type });

    if (erroUpload) {
      console.error(erroUpload);
      return { erro: 'Não foi possível enviar a imagem.' };
    }

    const { data: url } = this.supabase.storage.from('postagens').getPublicUrl(caminho);
    return { url: url.publicUrl };
  }

/**
 * Apaga a foto no storage a partir da URL pública, seja do feed ou do evento.
 * Falha silenciosa: é limpeza, e o chamador já gravou o dado na tabela.
 *
 * A guarda exige que a foto esteja na pasta de quem está chamando. Isso
 * protege a URL de ser adulterada para apontar para a pasta de outro, mas
 * tem uma consequência: quem troca a capa de um evento criado por outra
 * pessoa não consegue apagar o arquivo antigo — ele vira órfão no bucket.
 * A alternativa (liberar remoção para qualquer autenticado) abriria espaço
 * para um usuário apagar a foto de outro, o que é bem pior.
 */
async removerImagem(url: string): Promise<void> {
  try {
    const caminho = this.caminhoDaUrlBucket(url);
    if (!caminho) return;

    const user = await this.getUser();
    // Guarda contra URL adulterada apontando para a pasta de outro usuário.
    if (!user || !caminho.startsWith(`${user.id}/`)) return;

    await this.supabase.storage.from('postagens').remove([caminho]);
  } catch {
    // limpeza best-effort
  }
}

  /** Extrai o caminho do objeto de uma URL pública do bucket `postagens`. */
  private caminhoDaUrlBucket(url: string): string {
    const marcador = '/object/public/postagens/';
    const indice = url.indexOf(marcador);
    if (indice === -1) return '';
    return decodeURIComponent(url.slice(indice + marcador.length));
  }

  /**
   * `crypto.randomUUID` só existe em contexto seguro. Se a aplicação for
   * servida em http sem TLS ele some, e um throw aqui travaria o botão de
   * publicar em "Publicando..." para sempre.
   */
  private idAleatorio(): string {
    return (
      crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    );
  }

// --- ARRECADACOES ---

getVendasArrecadacao() {
  return this.supabase
    .from('vendas_arrecadacao')
    .select(`
      *,
      membro:membros(id, nome_completo, email, telefone),
      itens:itens_venda_arrecadacao(*)
    `)
    .order('data_venda', { ascending: false })
    .order('criado_em', { ascending: false });
}

getSaidasCaixa(caixaIds: string[]) {
  if (!caixaIds.length) {
    return Promise.resolve({ data: [] as any[], error: null });
  }

  return this.supabase
    .from('saidas_caixa')
    .select('*')
    .in('caixa_id', caixaIds)
    .order('criado_em', { ascending: false });
}

registrarSaidaCaixa(caixaId: string, saida: { valor: number; troco: number; motivo: string }) {
  return this.supabase
    .from('saidas_caixa')
    .insert([
      {
        caixa_id: caixaId,
        valor: saida.valor,
        troco: saida.troco,
        motivo: saida.motivo
      }
    ])
    .select()
    .single();
}

  /**
   * Corrige uma saída já registrada.
   *
   * `valor_efetivo` é coluna gerada no banco (valor - troco), então não entra
   * aqui: o Postgres recalcula sozinho.
   *
   * `atualizado_por` e `atualizado_em` também não entram: quem editou e quando
   * são carimbados pelo trigger `saidas_caixa_marca_edicao`, no banco. Antes o
   * front-end mandava os dois campos, o que quebrava a edição com PGRST204
   * (a interface SaidaCaixa nem os declarava) e deixava a rastro de auditoria
   * falsificável pelo próprio cliente.
   */
  atualizarSaidaCaixa(saidaId: string, saida: { valor: number; troco: number; motivo: string }) {
    return this.supabase
      .from('saidas_caixa')
      .update({
        valor: saida.valor,
        troco: saida.troco,
        motivo: saida.motivo
      })
      .eq('id', saidaId);
  }

  removerSaidaCaixa(saidaId: string) {
    return this.supabase.from('saidas_caixa').delete().eq('id', saidaId);
  }

async reabrirCaixa(caixaId: string, observacoes: string) {
  return this.supabase.rpc('reabrir_caixa', {
    p_caixa_id: caixaId,
    p_observacoes: observacoes
  });
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

  /** Quita a venda: status e forma de pagamento são do nível da venda. */
  marcarVendaArrecadacaoComoPaga(id: string, formaPagamento: 'pix' | 'debito' | 'credito' | 'dinheiro') {
    return this.marcarVendasArrecadacaoComoPagas([id], formaPagamento);
  }

  /**
   * Quita várias vendas de uma só vez.
   *
   * A conta de fiado de uma pessoa pode ter mais de uma venda em aberto, e
   * quitar uma por vez obrigaria a repetir a mesma confirmação N vezes. Uma
   * única chamada deixa o caixa inteiro no mesmo estado, mesmo que a tela feche
   * no meio.
   */
  marcarVendasArrecadacaoComoPagas(ids: string[], formaPagamento: 'pix' | 'debito' | 'credito' | 'dinheiro') {
    if (!ids.length) {
      return Promise.resolve({ data: null, error: null });
    }

    return this.supabase
      .from('vendas_arrecadacao')
      .update({
        status: 'pago',
        forma_pagamento: formaPagamento,
        data_pagamento: new Date().toISOString(),
        atualizado_em: new Date().toISOString()
      })
      .in('id', ids);
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