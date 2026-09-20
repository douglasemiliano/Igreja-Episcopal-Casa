import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SupabaseService } from '../../../services/supabase.service';

@Component({
  selector: 'app-detalhe-membro', standalone: true,
  imports: [CommonModule, DatePipe, RouterModule, MatIconModule],
  templateUrl: './detalhe-membro.component.html', styleUrl: './detalhe-membro.component.scss'
})
export class DetalheMembroComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SupabaseService);
  membro: any;
  confirmacoes: any[] = [];
  fiados: any[] = [];
  registros: any[] = [];
  carregando = true;
  erro = '';

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    const [membro, historico] = await Promise.all([this.supabase.getMembro(id), this.supabase.getHistoricoMembro(id)]);
    this.membro = membro.data;
    this.confirmacoes = historico[0].data ?? [];
    this.fiados = (historico[1].data ?? []).filter((venda: any) => venda.forma_pagamento === 'fiado');
    this.registros = historico[2].data ?? [];
    this.erro = membro.error ? 'Membro não encontrado.' : '';
    this.carregando = false;
  }

  moeda(valor: number): string { return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
}