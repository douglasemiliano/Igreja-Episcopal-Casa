import { inject, Injectable } from '@angular/core';
import { PermissaoService } from './permissao.service';
import { SupabaseService } from './supabase.service';
import { MembroVinculoService } from './membro-vinculo.service';
import {
  Celula,
  CelulaComResumo,
  DadosCelula,
  DetalheCelula,
  MinhaCelula,
  Participante,
  PapelCelula,
  ResultadoCelula,
  normalizarMinhasCelulas,
  normalizarPapel
} from '../model/celula.model';

/** Erro do PostgREST, no formato que o cliente devolve. */
interface ErroSupabase {
  code?: string;
  message?: string;
}

/** A linha de `celula_membros` como o PostgREST entrega, com `membros` aninhado. */
interface LinhaParticipante {
  papel: string;
  criado_em?: string | null;
  membros: {
    id: string;
    nome_completo: string;
    telefone?: string | null;
    email?: string | null;
    funcao?: string | null;
    data_entrada?: string | null;
    confirmacao?: { id: string }[] | { id: string } | null;
  } | null;
}

/** `celula_membros` chega como array quando há relação, null quando não há. */
type RelacaoParticipantes = LinhaParticipante[] | null;

interface CelulaComRelacao extends Celula {
  celula_membros?: RelacaoParticipantes;
}

/**
 * Células: listagem, detalhe e formação do grupo.
 *
 * As escritas vão direto pelo cliente do PostgREST e são barradas pela RLS de
 * supabase/20260930_celulas.sql — não há RPC de escrita. A exceção é a leitura
 * da célula da própria conta no perfil, que vem da função
 * public.minhas_celulas() e devolve jsonb.
 *
 * Uma regra que a interface não pode ignorar: o índice único em
 * `celula_membros (membro_id)` faz o banco recusar o segundo vínculo da mesma
 * pessoa. O erro chega como 23505 e, se for repassado como está, a pessoa lê
 * "duplicate key value violates unique constraint" e não entende nada. Por
 * isso `adicionarMembro` traduz esse caso.
 */
@Injectable({ providedIn: 'root' })
export class CelulaService {
  private readonly supabase = inject(SupabaseService);
  private readonly permissao = inject(PermissaoService);
  private readonly vinculo = inject(MembroVinculoService);

  /**
   * Lista as células com o resumo de quem está em cada uma.
   *
   * A relação `celula_membros(membros(...))` vem junto na mesma consulta: o
   * cartão precisa dos líderes e do total, e buscar isso depois seria uma
   * segunda ida ao banco por célula.
   */
  async listar(soAtivas = true): Promise<CelulaComResumo[]> {
    let consulta = this.supabase.supabase
      .from('celulas')
      .select(
        `id, nome, descricao, dia_semana, local, horario, ativa, criado_em,
         celula_membros(papel, membros(id, nome_completo))`
      )
      .order('nome', { ascending: true });

    if (soAtivas) {
      consulta = consulta.eq('ativa', true);
    }

    const { data, error } = await consulta;
    if (error) {
      console.error('[celulas] listar falhou:', error.code, error.message);
      throw new Error('Não foi possível carregar as células.');
    }

    return ((data ?? []) as unknown as CelulaComRelacao[]).map((linha) => {
      const participantes = (linha.celula_membros ?? []).filter((item) => !!item.membros);
      const { celula_membros: _omitido, ...celula } = linha;

      return {
        ...celula,
        total_membros: participantes.length,
        lideres: participantes
          .filter((item) => item.papel === 'lider')
          .map((item) => item.membros!.nome_completo)
      };
    });
  }

  /**
   * Uma célula e quem participa dela.
   *
   * `sou_lider` sai daqui pela comparação com o id do membro da conta
   * logada, e não de uma consulta a parte. Um filtro do PostgREST em relação
   * embutida (`celula_membros.membros.user_id`) exigiria `!inner` e reescrever
   * a consulta inteira; como os participantes já vieram, a resposta está no
   * próprio resultado.
   */
  async detalhe(celulaId: string): Promise<DetalheCelula> {
    const { data, error } = await this.supabase.supabase
      .from('celulas')
      .select(
        `id, nome, descricao, dia_semana, local, horario, ativa, criado_em,
         celula_membros(papel, criado_em, membros(id, nome_completo, telefone, email, funcao, data_entrada,
           confirmacao:confirmacoes_membros(id)))`
      )
      .eq('id', celulaId)
      .maybeSingle();

    if (error) {
      console.error('[celulas] detalhe falhou:', error.code, error.message);
      throw new Error('Não foi possível abrir a célula.');
    }
    if (!data) throw new Error('Célula não encontrada.');

    const bruta = data as unknown as CelulaComRelacao;

    const participantes: Participante[] = (bruta.celula_membros ?? [])
      .filter((linha) => !!linha.membros)
      .map((linha) => ({
        membro_id: linha.membros!.id,
        nome: linha.membros!.nome_completo,
        papel: normalizarPapel(linha.papel),
        telefone: linha.membros!.telefone ?? null,
        email: linha.membros!.email ?? null,
        funcao: linha.membros!.funcao ?? null,
        data_entrada: linha.membros!.data_entrada ?? null,
        // `confirmarMembro` grava confirmações, e a listagem de membros lê o
        // mesmo shape: array quando há mais de uma, objeto quando é uma só.
        confirmado: this.temConfirmacao(linha.membros!.confirmacao),
        criado_em: linha.criado_em ?? null
      }))
      .sort((a, b) => {
        // Líderes primeiro: é quem a pessoa procura na tela.
        if (a.papel !== b.papel) return a.papel === 'lider' ? -1 : 1;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      });

    const celula: Celula = {
      id: bruta.id,
      nome: bruta.nome,
      descricao: bruta.descricao ?? null,
      dia_semana: bruta.dia_semana ?? null,
      local: bruta.local ?? null,
      horario: bruta.horario ?? null,
      ativa: bruta.ativa,
      criado_em: bruta.criado_em ?? null
    };

    const meuId = await this.meuMembroId();
    return {
      celula,
      participantes,
      sou_lider: !!meuId && participantes.some((p) => p.membro_id === meuId && p.papel === 'lider')
    };
  }

  /** Uma pessoa é "confirmada" quando existe ao menos uma confirmação. */
  private temConfirmacao(confirmacao: NonNullable<LinhaParticipante['membros']>['confirmacao']): boolean {
    if (!confirmacao) return false;
    return Array.isArray(confirmacao) ? confirmacao.length > 0 : true;
  }

  /**
   * Cria ou atualiza a célula.
   *
   * Criar e editar estão juntos porque a tela usa os mesmos campos; separar
   * obrigaria a duplicar a validação do nome.
   */
  async salvar(dados: DadosCelula, id?: string | null): Promise<ResultadoCelula> {
    const nome = (dados.nome ?? '').trim();
    if (!nome) {
      return { status: 'erro', mensagem: 'A célula precisa de um nome.' };
    }

    const registro = {
      nome,
      descricao: this.texto(dados.descricao),
      dia_semana: this.texto(dados.dia_semana),
      local: this.texto(dados.local),
      // `time` do banco não aceita string vazia: campo não preenchido vira null.
      horario: this.texto(dados.horario) || null,
      ativa: dados.ativa ?? true
    };

    if (id) {
      const { data, error } = await this.supabase.supabase
        .from('celulas')
        .update(registro)
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('[celulas] salvar falhou:', error.code, error.message);
        return { status: 'erro', mensagem: 'Não foi possível salvar as alterações da célula.' };
      }
      return { status: 'ok', id: data?.id ?? id };
    }

    const { data, error } = await this.supabase.supabase
      .from('celulas')
      .insert(registro)
      .select('id')
      .single();

    if (error) {
      console.error('[celulas] criar falhou:', error.code, error.message);
      return { status: 'erro', mensagem: 'Não foi possível criar a célula.' };
    }
    return { status: 'ok', id: data?.id ?? null };
  }

  async excluir(celulaId: string): Promise<ResultadoCelula> {
    const { error } = await this.supabase.supabase.from('celulas').delete().eq('id', celulaId);
    if (error) {
      console.error('[celulas] excluir falhou:', error.code, error.message);
      return { status: 'erro', mensagem: 'Não foi possível excluir a célula.' };
    }
    return { status: 'ok' };
  }

  /** Coloca uma pessoa na célula, como líder ou como participante. */
  async adicionarMembro(
    celulaId: string,
    membroId: string,
    papel: PapelCelula = 'membro'
  ): Promise<ResultadoCelula> {
    const { error } = await this.supabase.supabase
      .from('celula_membros')
      .insert({ celula_id: celulaId, membro_id: membroId, papel });

    if (!error) return { status: 'ok' };
    return this.traduzirVinculo(error, 'Não foi possível adicionar o membro na célula.');
  }

  /** Promove a pessoa a líder da célula, ou devolve o papel. */
  async definirPapel(celulaId: string, membroId: string, papel: PapelCelula): Promise<ResultadoCelula> {
    const { error } = await this.supabase.supabase
      .from('celula_membros')
      .update({ papel })
      .eq('celula_id', celulaId)
      .eq('membro_id', membroId);

    if (!error) return { status: 'ok' };
    console.error('[celulas] definirPapel falhou:', error.code, error.message);
    return { status: 'erro', mensagem: 'Não foi possível mudar o papel na célula.' };
  }

  async removerMembro(celulaId: string, membroId: string): Promise<ResultadoCelula> {
    const { error } = await this.supabase.supabase
      .from('celula_membros')
      .delete()
      .eq('celula_id', celulaId)
      .eq('membro_id', membroId);

    if (!error) return { status: 'ok' };
    console.error('[celulas] removerMembro falhou:', error.code, error.message);
    return { status: 'erro', mensagem: 'Não foi possível remover o membro da célula.' };
  }

  /**
   * Membros que ainda NÃO estão em nenhuma célula, para o seletor de adicionar.
   *
   * São duas consultas em vez de uma com `not in` do PostgREST: filtrar em
   * memória o conjunto de quem já está ocupado é previsível, e a lista de
   * membros da igreja cabe folgada. O filtro de fora do banco é o índice único
   * em `membro_id`, não esta lista — se alguém ficar em outra célula entre as
   * duas consultas, o insert é recusado com 23505 e `adicionarMembro`
   * traduz.
   */
  async membrosLivres(): Promise<{ id: string; nome: string }[]> {
    const [{ data: membros, error: erroMembros }, { data: ocupados }] = await Promise.all([
      this.supabase.supabase
        .from('membros')
        .select('id, nome_completo')
        .order('nome_completo', { ascending: true }),
      this.supabase.supabase.from('celula_membros').select('membro_id')
    ]);

    if (erroMembros) {
      console.error('[celulas] membrosLivres falhou:', erroMembros.code, erroMembros.message);
      return [];
    }

    const emAlgumaCelula = new Set(
      ((ocupados ?? []) as { membro_id: string }[]).map((linha) => linha.membro_id)
    );

    return ((membros ?? []) as { id: string; nome_completo: string }[])
      .filter((membro) => !emAlgumaCelula.has(membro.id))
      .map((membro) => ({ id: membro.id, nome: membro.nome_completo }));
  }

  /**
   * A célula de um membro específico — não a da conta logada, mas de quem o
   * perfil está exibindo. O detalhe do membro usa para mostrar "participa de X".
   *
   * O índice único em `membro_id` garante no máximo uma célula por pessoa, por
   * isso o `maybeSingle`. Sem contato com célula não é erro: a pessoa só não
   * participa de nenhuma, e a tela mostra isso.
   */
  async celulaDoMembro(membroId: string): Promise<{ id: string; nome: string; papel: PapelCelula } | null> {
    const { data, error } = await this.supabase.supabase
      .from('celula_membros')
      .select('papel, celulas(id, nome)')
      .eq('membro_id', membroId)
      .maybeSingle();

    if (error) {
      console.error('[celulas] celulaDoMembro falhou:', error.code, error.message);
      return null;
    }
    if (!data) return null;

    const linha = data as unknown as { papel: string; celulas: { id: string; nome: string } | null };
    if (!linha.celulas) return null;

    return { id: linha.celulas.id, nome: linha.celulas.nome, papel: normalizarPapel(linha.papel) };
  }

  /**
   * Células da conta logada, para o /perfil.
   *
   * Falha aqui não é erro de tela: o perfil mostra o resto normalmente e só o
   * bloco da célula some. Por isso engole o erro em vez de jogar.
   */
  async minhasCelulas(): Promise<MinhaCelula[]> {
    const { data, error } = await this.supabase.supabase.rpc('minhas_celulas');
    if (error) {
      console.error('[celulas] minhas_celulas falhou:', error.code, error.message);
      return [];
    }
    return normalizarMinhasCelulas(data);
  }

  /** `true` com permissão de criar, editar e excluir células. */
  get podeGerenciar(): boolean {
    return this.permissao.pode('gerenciar_celulas');
  }

  /**
   * `true` quando quem está logado pode formar o grupo de alguma célula.
   *
   * A chave `vincular_membros_celula` responde a maior parte dos casos, mas o
   * líder de uma célula também monta a própria célula sem ser da secretaria, e
   * essa informação não está no catálogo: sai das participações da pessoa. Por
   * isso é método assíncrono e não um getter como `podeGerenciar`.
   */
  async podeVincular(): Promise<boolean> {
    if (this.permissao.pode('vincular_membros_celula')) return true;
    const minhas = await this.minhasCelulas();
    return minhas.some((celula) => celula.papel === 'lider');
  }

  /** Id do membro ligado à conta logada, ou null se a conta não tem cadastro. */
  private async meuMembroId(): Promise<string | null> {
    const vinculo = await this.vinculo.meuMembro();
    return vinculo?.id ?? null;
  }

  /**
   * Traduz o 23505, que é o índice de uma célula por membro estourando. É o
   * erro mais provável desta tela, e o que chega sem dizer de quem é a culpa.
   */
  private traduzirVinculo(error: ErroSupabase, padrao: string): ResultadoCelula {
    if (error.code === '23505') {
      return {
        status: 'erro',
        mensagem: 'Esta pessoa já participa de outra célula. Retire-a de lá antes de colocá-la nesta.'
      };
    }
    console.error('[celulas] vinculo falhou:', error.code, error.message);
    return { status: 'erro', mensagem: padrao };
  }

  /** Texto opcional sempre como string limpa, nunca `undefined`. */
  private texto(valor?: string | null): string {
    return (valor ?? '').trim();
  }
}
