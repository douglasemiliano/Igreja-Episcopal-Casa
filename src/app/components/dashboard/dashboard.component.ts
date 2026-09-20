import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

interface CategoriaResumo { nome: string; total: number; percentual: number; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, MatIconModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  carregando = true;
  erro = '';
  totalMembros = 0;
  totalLecionarios = 0;
  totalConfirmacoes = 0;
  totalArrecadado = 0;
  totalFiado = 0;
  membrosRecentes: any[] = [];
  proximosEventos: any[] = [];
  categorias: CategoriaResumo[] = [];
  ultimasAcoes: any[] = [];

  async ngOnInit(): Promise<void> {
    const [membros, lecionarios, confirmacoes, vendas, agenda] = await Promise.all([
      this.supabase.getMembrosComConfirmacao(), this.supabase.getTodosLectionary(),
      this.supabase.getConfirmacoes(), this.supabase.getVendasArrecadacao(),
      this.supabase.getAgenda({ inicio: new Date().toISOString() })
    ]);
    this.totalMembros = membros.data?.length ?? 0;
    this.totalLecionarios = lecionarios.data?.length ?? 0;
    this.totalConfirmacoes = confirmacoes.data?.length ?? 0;
    this.membrosRecentes = (membros.data ?? []).slice(-5).reverse();
    this.proximosEventos = (agenda.data ?? []).slice(0, 3);
    const vendasData = vendas.data ?? [];
    this.totalArrecadado = vendasData.filter((venda: any) => venda.status === 'pago').reduce((total: number, venda: any) => total + Number(venda.total), 0);
    this.totalFiado = vendasData.filter((venda: any) => venda.status === 'pendente').reduce((total: number, venda: any) => total + Number(venda.total), 0);
    this.ultimasAcoes = vendasData.slice(0, 5);
    const porCategoria = new Map<string, number>();
    vendasData.forEach((venda: any) => (venda.itens ?? []).forEach((item: any) => porCategoria.set(item.categoria, (porCategoria.get(item.categoria) ?? 0) + Number(item.valor_total))));
    const maior = Math.max(...porCategoria.values(), 1);
    this.categorias = [...porCategoria.entries()].map(([nome, total]) => ({ nome: nome === 'bazar' ? 'Bazar' : nome === 'feijoada' ? 'Feijoada' : 'Hamburgada', total, percentual: Math.round((total / maior) * 100) }));
    this.erro = membros.error || vendas.error || agenda.error ? 'Alguns dados não puderam ser carregados.' : '';
    this.carregando = false;
  }

  moeda(valor: number): string { return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
}
