import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartData, ChartOptions } from 'chart.js';
import { SupabaseService } from '../../services/supabase.service';
import { CaixaService } from '../../services/caixa.service';

interface CategoriaResumo { nome: string; total: number; percentual: number; }

const NOMES_CATEGORIA: Record<string, string> = { bazar: 'Bazar', hamburgada: 'Hamburgada', feijoada: 'Feijoada' };
const PALETA_CAIXAS = ['#6a1b9a', '#16cdc7', '#f8c20a', '#0a71f8', '#f80abd', '#a8651d', '#2ca87b', '#d84315', '#5c6bc0', '#00897b'];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, MatIconModule, RouterModule, BaseChartDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly caixaService = inject(CaixaService);
  private vendasTodas: any[] = [];
  private caixasTodas: any[] = [];
  caixaAtual: any = null;
  carregando = true;
  erro = '';
  roles: string[] = ['membro'];
  totalMembros = 0;
  totalLecionarios = 0;
  totalConfirmacoes = 0;
  totalArrecadado = 0;
  totalFiado = 0;
  membrosRecentes: any[] = [];
  proximosEventos: any[] = [];
  categorias: CategoriaResumo[] = [];
  ultimasAcoes: any[] = [];

  evolucaoMensalData: ChartData<'bar'> = { labels: [], datasets: [] };
  mesesEvolucao: { chave: string; rotulo: string; total: number }[] = [];
  temEvolucaoMensal = false;
  barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (contexto) => `${contexto.dataset.label ?? ''}: ${this.moeda(contexto.parsed.y)}` } }
    },
    scales: {
      x: { ticks: { color: 'currentColor' }, grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: { color: 'currentColor', callback: (valor) => this.moeda(Number(valor)) },
        grid: { color: 'rgba(128,128,128,.15)' }
      }
    }
  };


  async ngOnInit(): Promise<void> {
    this.roles = await this.supabase.getRoles();
    this.caixaAtual = await this.caixaService.carregarCaixa();
    const [membros, lecionarios, confirmacoes, vendas, agenda, caixas] = await Promise.all([
      this.supabase.getMembrosComConfirmacao(), this.supabase.getTodosLectionary(),
      this.supabase.getConfirmacoes(), this.supabase.getVendasArrecadacao(),
      this.supabase.getAgenda({ inicio: new Date().toISOString() }),
      this.supabase.getTodasCaixas()
    ]);
    this.totalMembros = membros.data?.length ?? 0;
    this.totalLecionarios = lecionarios.data?.length ?? 0;
    this.totalConfirmacoes = confirmacoes.data?.length ?? 0;
    this.membrosRecentes = (membros.data ?? []).slice(-5).reverse();
    this.proximosEventos = (agenda.data ?? []).slice(0, 3);
    const vendasData = vendas.data ?? [];
    this.vendasTodas = vendasData;
    this.caixasTodas = caixas.data ?? [];
    this.totalArrecadado = vendasData.filter((venda: any) => venda.status === 'pago').reduce((total: number, venda: any) => total + Number(venda.total), 0);
    this.totalFiado = vendasData.filter((venda: any) => venda.status === 'pendente').reduce((total: number, venda: any) => total + Number(venda.total), 0);
    this.ultimasAcoes = vendasData.slice(0, 5);
    const porCategoria = new Map<string, number>();
    vendasData.forEach((venda: any) => (venda.itens ?? []).forEach((item: any) => porCategoria.set(item.categoria, (porCategoria.get(item.categoria) ?? 0) + Number(item.valor_total))));
    const maior = Math.max(...porCategoria.values(), 1);
    this.categorias = [...porCategoria.entries()].map(([nome, total]) => ({ nome: NOMES_CATEGORIA[nome] ?? nome, total, percentual: Math.round((total / maior) * 100) }));
    this.erro = membros.error || vendas.error || agenda.error || caixas.error ? 'Alguns dados não puderam ser carregados.' : '';
    this.montarEvolucaoMensal();
    this.carregando = false;
  }


      async carregarCaixa(): Promise<void> {
  const { data, error } = await this.supabase.getCaixaAberto();
  if (error) {
    console.error(error);
    return;
  }
  this.caixaAtual = data ?? null;
}

  moeda(valor: number): string { return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  temPermissao(roles: string[]): boolean {
    return roles.some((role) => this.roles.includes(role));
  }

  private montarEvolucaoMensal(): void {
    const agora = new Date();
    const meses: { chave: string; rotulo: string; total: number }[] = [];
    for (let indice = 11; indice >= 0; indice--) {
      const data = new Date(agora.getFullYear(), agora.getMonth() - indice, 1);
      const chave = this.chaveMes(data);
      meses.push({ chave, rotulo: this.rotuloMes(data), total: 0 });
    }

    const mesCaixa = new Map<string, string>();
    this.caixasTodas.forEach((caixa: any) => mesCaixa.set(caixa.id, caixa.aberto_em?.slice(0, 7) ?? ''));

    this.vendasTodas
      .filter((venda: any) => venda.status === 'pago')
      .forEach((venda: any) => {
        const mes = mesCaixa.get(venda.caixa_id);
        if (!mes) return;
        const registro = meses.find((item) => item.chave === mes);
        if (registro) registro.total += Number(venda.total ?? 0);
      });

    this.mesesEvolucao = meses;
    this.temEvolucaoMensal = meses.some((item) => item.total > 0);
    this.evolucaoMensalData = {
      labels: meses.map((item) => item.rotulo),
      datasets: [{
        label: 'Total arrecadado',
        data: meses.map((item) => item.total),
        backgroundColor: meses.map((_, indice) => PALETA_CAIXAS[indice % PALETA_CAIXAS.length]),
        borderRadius: 6
      }]
    };
  }

  private chaveMes(data: Date): string {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
  }

  private rotuloMes(data: Date): string {
    return data.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(data.getFullYear()).slice(-2);
  }

formatarDataHora(data: string): string {
  return new Date(data).toLocaleString('pt-BR');
}

}