import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartData, ChartOptions } from 'chart.js';
import { SupabaseService } from '../../services/supabase.service';

interface CategoriaResumo { nome: string; total: number; percentual: number; }

interface CaixaDia {
  id: string;
  aberto_em: string;
  fechado_em?: string | null;
  total: number;
  totalFiado: number;
  totais: Record<'bazar' | 'hamburgada' | 'feijoada', number>;
}

const CORES_CATEGORIA: Record<string, string> = { bazar: '#6a1b9a', hamburgada: '#f8c20a', feijoada: '#16cdc7' };
const NOMES_CATEGORIA: Record<string, string> = { bazar: 'Bazar', hamburgada: 'Hamburgada', feijoada: 'Feijoada' };
const CORES_FORMA: Record<string, string> = { pix: '#16cdc7', debito: '#0a71f8', credito: '#f8c20a', dinheiro: '#2ca87b', fiado: '#a8651d' };
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
  private vendasTodas: any[] = [];
  private caixasTodas: any[] = [];

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

  diaCaixa = new Date().toISOString().slice(0, 10);
  carregandoCaixasDia = false;
  caixasDia: CaixaDia[] = [];
  totalDia = 0;
  fiadoDia = 0;
  vendasCategoriaData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  vendasFormaData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  vendasCaixaData: ChartData<'bar'> = { labels: [], datasets: [] };
  evolucaoMensalData: ChartData<'bar'> = { labels: [], datasets: [] };
  mesesEvolucao: { chave: string; rotulo: string; total: number }[] = [];
  temEvolucaoMensal = false;
  doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: 'currentColor', usePointStyle: true, pointStyle: 'circle' } },
      tooltip: { callbacks: { label: (contexto) => `${contexto.label}: ${this.moeda(contexto.parsed)}` } }
    }
  };
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
    await this.carregarCaixasDia();
  }

  moeda(valor: number): string { return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

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

  async carregarCaixasDia(): Promise<void> {
    if (!this.diaCaixa) return;
    this.carregandoCaixasDia = true;
    const inicio = `${this.diaCaixa}T00:00:00`;
    const fim = `${this.diaCaixa}T23:59:59.999`;
    const { data, error } = await this.supabase.getCaixas({ inicio, fim });
    if (error) {
      console.error(error);
      this.carregandoCaixasDia = false;
      return;
    }

    const caixas = data ?? [];
    const ids = new Set<string>(caixas.map((caixa: any) => caixa.id));
    const vendasDia = this.vendasTodas.filter((venda: any) => ids.has(venda.caixa_id));
    const pagas = vendasDia.filter((venda: any) => venda.status === 'pago');
    const pendentes = vendasDia.filter((venda: any) => venda.status === 'pendente');

    this.caixasDia = caixas.map((caixa: any) => {
      const pagasCaixa = pagas.filter((venda: any) => venda.caixa_id === caixa.id);
      const pendentesCaixa = pendentes.filter((venda: any) => venda.caixa_id === caixa.id);
      const totais = { bazar: 0, hamburgada: 0, feijoada: 0 };
      pagasCaixa.forEach((venda: any) =>
        (venda.itens ?? []).forEach((item: any) => {
          if (item.categoria in totais) totais[item.categoria as keyof typeof totais] += Number(item.valor_total ?? 0);
        })
      );
      return {
        id: caixa.id,
        aberto_em: caixa.aberto_em,
        fechado_em: caixa.fechado_em,
        totais,
        total: pagasCaixa.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0),
        totalFiado: pendentesCaixa.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0)
      };
    });

    this.totalDia = pagas.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0);
    this.fiadoDia = pendentes.reduce((soma, venda) => soma + Number(venda.total ?? 0), 0);

    this.montarGraficosDia(pagas);
    this.carregandoCaixasDia = false;
  }

  private montarGraficosDia(pagas: any[]): void {
    const categorias = ['bazar', 'hamburgada', 'feijoada'] as const;
    const porCategoria = { bazar: 0, hamburgada: 0, feijoada: 0 };
    const porForma = new Map<string, number>();
    pagas.forEach((venda: any) => {
      (venda.itens ?? []).forEach((item: any) => {
        if (item.categoria in porCategoria) porCategoria[item.categoria as keyof typeof porCategoria] += Number(item.valor_total ?? 0);
      });
      const forma = venda.forma_pagamento ?? 'dinheiro';
      porForma.set(forma, (porForma.get(forma) ?? 0) + Number(venda.total ?? 0));
    });

    this.vendasCategoriaData = {
      labels: categorias.map((c) => NOMES_CATEGORIA[c]),
      datasets: [{
        data: categorias.map((c) => porCategoria[c]),
        backgroundColor: categorias.map((c) => CORES_CATEGORIA[c]),
        borderColor: 'transparent'
      }]
    };

    this.vendasFormaData = {
      labels: [...porForma.keys()],
      datasets: [{
        data: [...porForma.values()],
        backgroundColor: [...porForma.keys()].map((forma) => CORES_FORMA[forma] ?? '#9e9e9e'),
        borderColor: 'transparent'
      }]
    };

    this.vendasCaixaData = {
      labels: this.caixasDia.map((_, indice) => `Caixa ${indice + 1}`),
      datasets: [{
        label: 'Total vendido',
        data: this.caixasDia.map((caixa) => caixa.total),
        backgroundColor: this.caixasDia.map((_, indice) => PALETA_CAIXAS[indice % PALETA_CAIXAS.length]),
        borderRadius: 6
      }]
    };
  }
}