import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SupabaseService } from '../../../services/supabase.service';
import { CelulaService } from '../../../services/celula.service';

@Component({
  selector: 'app-detalhe-membro', standalone: true,
  imports: [CommonModule, DatePipe, RouterModule, MatIconModule],
  templateUrl: './detalhe-membro.component.html', styleUrl: './detalhe-membro.component.scss'
})
export class DetalheMembroComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  private readonly celulas = inject(CelulaService);
  membro: any;
  confirmacoes: any[] = [];
  fiados: any[] = [];
  registros: any[] = [];
  carregando = true;
  erro = '';

  /** Foto do membro (vem de `profiles.foto`; `membros` não tem foto). */
  foto = '';
  /** Célula de que o membro participa, ou null quando não participa de nenhuma. */
  celula: { id: string; nome: string; papel: string } | null = null;
  /**
   * Para onde o "voltar" leva. O perfil pode ser aberto de dois lugares: da
   * lista de membros (volta para a lista) ou do detalhe de uma célula, quando
   * a pessoa clica num participante (volta para a célula — e não para a lista,
   * que seria perder o contexto de onde ela veio). A origem chega como query
   * param `origem=/celulas/<id>`; quem não vem da célula volta para /membros.
   */
  voltar = ['/membros'];
  rotuloVoltar = 'Voltar para membros';

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    const origem = this.route.snapshot.queryParamMap.get('origem');
    if (origem && origem.startsWith('/celulas/')) {
      this.voltar = [origem];
      this.rotuloVoltar = 'Voltar para a célula';
    }

    const [membro, historico] = await Promise.all([this.supabase.getMembro(id), this.supabase.getHistoricoMembro(id)]);
    this.membro = membro.data;
    this.confirmacoes = historico[0].data ?? [];
    this.fiados = (historico[1].data ?? []).filter((venda: any) => venda.forma_pagamento === 'fiado');
    this.registros = historico[2].data ?? [];
    this.erro = membro.error ? 'Membro não encontrado.' : '';
    this.carregando = false;

    if (this.membro) {
      const idDaConta: string | null = this.membro.user_id ?? null;
      this.foto = (await this.supabase.getFotoMembro(idDaConta ?? '')) ?? '';
      this.celula = await this.celulas.celulaDoMembro(id);
    }
  }

  /** Iniciais usadas até a foto carregar, e como fallback quando não há. */
  iniciais(): string {
    const partes = (this.membro?.nome_completo ?? '').trim().split(/\s+/).filter(Boolean);
    return (partes[0]?.[0] ?? '?').toUpperCase();
  }

  moeda(valor: number): string { return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
}