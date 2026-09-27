import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PermissaoService } from '../../../services/permissao.service';
import { SupabaseService } from '../../../services/supabase.service';
import { ToastService } from '../../../services/toast.service';

interface LinhaPermissao {
  chave: string;
  rotulo: string;
  descricao: string;
  categoria: string;
  reservada: boolean;
  /** Papeis que possuem esta capacidade. */
  papeis: string[];
}

interface GrupoCategoria {
  titulo: string;
  linhas: LinhaPermissao[];
}

/**
 * Tela de gerenciamento das capacidades.
 *
 * O administrador decide, por papel, quem pode fazer o quê. A coluna
 * "administrador" aparece sempre marcada e não desliga: o bypass é
 * hardcoded em public.pode() no banco, e mexer aqui não muda nada — a tela
 * mentiria de novo, que é exatamente o que este projeto existe para evitar.
 *
 * Estas caixas não são a segurança: elas mandam no que a interface mostra.
 * Quem de fato aceita a operação é a RLS, consultando a mesma função no
 * banco. As duas coisas leem a mesma tabela, então não há como divergirem
 * sem que alguém escreva no banco por fora.
 */
@Component({
  selector: 'app-gerenciar-permissoes',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './gerenciar-permissoes.component.html',
  styleUrl: './gerenciar-permissoes.component.scss'
})
export class GerenciarPermissoesComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly permissao = inject(PermissaoService);
  private readonly toast = inject(ToastService);

  /**
   * O bypass do administrador é do banco, então a coluna entra na tela só
   * para aparecer marcada. Mexer nela não tem efeito e seria enganoso.
   */
  readonly admin = 'administrador';

  /**
   * Papeis que valem a pena exibir. `leitor` não entra: é o mesmo que
   * `membro` desde a migração de perfis, e dois nomes iguais na mesma linha
   * só fariam o administrador hesitar sobre qual marcar.
   */
  readonly papeis = this.supabase.rolesDisponiveis.filter((role) => role !== 'leitor');

  readonly rotulosPapeis: Record<string, string> = {
    administrador: 'Administrador',
    secretaria: 'Secretaria',
    caixa: 'Caixa',
    tesouraria: 'Tesouraria',
    pastor: 'Pastor',
    lider: 'Líder',
    membro: 'Membro'
  };

  grupos: GrupoCategoria[] = [];
  auditoria: any[] = [];
  carregando = true;
  salvando = '';
  erro = '';

  private catalogo: any[] = [];
  private concessoes = new Set<string>();

  async ngOnInit(): Promise<void> {
    await this.carregar();
  }

  async carregar(): Promise<void> {
    this.carregando = true;
    this.erro = '';

    try {
      const { catalogo, concessoes } = await this.supabase.carregarMatrizPermissoes();
      this.catalogo = catalogo;
      this.concessoes = new Set(concessoes.map((linha) => `${linha.chave}|${linha.role}`));
      this.montarGrupos();

      // O rastro é uma leitura extra e não pode derrubar a tela: se a policy
      // de auditoria não existir ainda, a matriz continua utilizável.
      this.supabase
        .carregarAuditoriaPermissoes()
        .then((linhas) => (this.auditoria = linhas))
        .catch(() => (this.auditoria = []));
    } catch (erro) {
      console.error(erro);
      this.erro = 'Não foi possível carregar as permissões. A migration pode não ter sido aplicada.';
    } finally {
      this.carregando = false;
    }
  }

  private montarGrupos(): void {
    const porCategoria = new Map<string, LinhaPermissao[]>();

    for (const item of this.catalogo) {
      const linha: LinhaPermissao = {
        chave: item.chave,
        rotulo: item.rotulo,
        descricao: item.descricao ?? '',
        categoria: item.categoria || 'Geral',
        reservada: !!item.reservada,
        papeis: this.papeis.filter((role) => this.concessoes.has(`${item.chave}|${role}`))
      };

      const atual = porCategoria.get(linha.categoria);
      if (atual) {
        atual.push(linha);
      } else {
        porCategoria.set(linha.categoria, [linha]);
      }
    }

    this.grupos = [...porCategoria.entries()].map(([titulo, linhas]) => ({
      titulo,
      linhas: linhas.sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
    }));
  }

  tem(linha: LinhaPermissao, role: string): boolean {
    return linha.papeis.includes(role);
  }

  rotuloPapel(role: string): string {
    return this.rotulosPapeis[role] ?? role;
  }

  /**
   * A troca vale na hora. Não há rascunho porque a mudança é do banco, e
   * alguém pode estar com a tela aberta esperando o botão aparecer.
   *
   * A interface vai antes do banco confirmar (otimista). Se a chamada falhar,
   * a linha volta ao estado anterior e o toast avisa — a matriz sempre
   * reflete o que o banco aceitou, não o que a tela tentou.
   */
  async alternar(linha: LinhaPermissao, role: string): Promise<void> {
    if (linha.reservada || this.salvando) return;

    const estavaMarcado = this.tem(linha, role);
    this.aplicarLocal(linha, role, !estavaMarcado);
    this.salvando = `${linha.chave}|${role}`;

    try {
      if (estavaMarcado) {
        await this.supabase.revogarPermissao(linha.chave, role);
        this.toast.sucesso(
          `${this.rotuloPapel(role)} não pode mais ${linha.rotulo.toLowerCase()}.`
        );
      } else {
        await this.supabase.concederPermissao(linha.chave, role);
        this.toast.sucesso(`${this.rotuloPapel(role)} agora pode ${linha.rotulo.toLowerCase()}.`);
      }

      // Recarrega a matriz para o conjunto refletir o banco, e não a
      // expansão otimista. Também pega a linha de auditoria nova.
      await this.carregar();
    } catch (erro) {
      console.error(erro);
      this.aplicarLocal(linha, role, estavaMarcado);
      this.toast.erro('Não foi possível alterar a permissão.');
    } finally {
      this.salvando = '';
    }
  }

  private aplicarLocal(linha: LinhaPermissao, role: string, marcar: boolean): void {
    const alvo = this.grupos.flatMap((grupo) => grupo.linhas).find((item) => item.chave === linha.chave);
    if (!alvo) return;

    if (marcar) {
      if (!alvo.papeis.includes(role)) alvo.papeis.push(role);
    } else {
      alvo.papeis = alvo.papeis.filter((item) => item !== role);
    }
  }

  estaSalvando(linha: LinhaPermissao, role: string): boolean {
    return this.salvando === `${linha.chave}|${role}`;
  }

  dataCurta(valor: string): string {
    if (!valor) return '';
    return new Date(valor).toLocaleString('pt-BR');
  }
}
