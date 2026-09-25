import { inject, Injectable } from '@angular/core';
import { AuthChangeEvent, createClient, Session, SupabaseClient } from '@supabase/supabase-js';
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

  getUser() {
    return this.supabase.auth.getUser().then(({ data }) => data.user);
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

addAgenda(evento: any) {
  return this.supabase.from('agenda_igreja').insert([evento]).select().single();
}

updateAgenda(id: string, evento: any) {
  return this.supabase.from('agenda_igreja').update(evento).eq('id', id).select().single();
}

deleteAgenda(id: string) {
  return this.supabase.from('agenda_igreja').delete().eq('id', id);
}

getRole() {
  return this.getUser().then(async (user) => {
    if (!user) return 'membro';
    const { data } = await this.supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = data?.role ?? user.user_metadata?.['role'] ?? 'membro';
    // 'leitor' foi renomeado para 'membro'; normaliza registros antigos.
    return role === 'leitor' ? 'membro' : role;
  });
}

listUsuarios() {
  return this.supabase
    .from('profiles')
    .select('id, role, nome, email, criado_em, atualizado_em')
    .order('nome', { ascending: true });
}

atualizarRoleUsuario(id: string, role: string) {
  return this.supabase
    .from('profiles')
    .update({ role, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
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