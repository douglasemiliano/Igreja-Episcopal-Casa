import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { LecionarioResponse } from '../../../model/Lecionario.model';
import { SupabaseService } from '../../../services/supabase.service';
import { LecionarioService } from '../../../services/lecionario.service';
import { Router } from '@angular/router';
import { ModalConfirmacaoService } from '../../utils/modal-confirmacao/modal-confirmacao.service';
import { ToastService } from '../../../services/toast.service';


@Component({
  selector: 'app-listar-lecionario',
  imports: [CommonModule, FormsModule, MatIconModule, DatePipe],
  templateUrl: './listar-lecionario.component.html',
  styleUrl: './listar-lecionario.component.scss',
  standalone: true
})
export class ListarLecionarioComponent {
  lecionarios: LecionarioResponse[] = [];
  filtro = '';
  pagina = 1;
  itensPorPagina = 10;
  opcoesPagina = [5, 10, 25, 50];
  colunaOrdenada = '';
  direcaoOrdenacao: 'asc' | 'desc' = 'asc';

  constructor(private supabaseService: SupabaseService,
    private lecionarioService: LecionarioService, private router: Router,
    private modalService: ModalConfirmacaoService, private toast: ToastService) {
    this.recuperarLecionario();
  }

  recuperarLecionario() {
    this.supabaseService.getLecionarioPorAnoLiturgico("C").then((response) => {
      this.lecionarios = response.data || [];
      this.pagina = 1;
    })
  }

  applyFilter(event: Event) {
    this.filtro = (event.target as HTMLInputElement).value.trim().toLowerCase();
    this.pagina = 1;
  }

  ordenar(coluna: string) {
    if (this.colunaOrdenada === coluna) {
      this.direcaoOrdenacao = this.direcaoOrdenacao === 'asc' ? 'desc' : 'asc';
    } else {
      this.colunaOrdenada = coluna;
      this.direcaoOrdenacao = 'asc';
    }
  }

  seta(coluna: string): string {
    if (this.colunaOrdenada !== coluna) return '';
    return this.direcaoOrdenacao === 'asc' ? '▲' : '▼';
  }

  lecionariosFiltrados(): LecionarioResponse[] {
    let lista = this.lecionarios;

    if (this.filtro) {
      lista = lista.filter(l =>
        [l.nome, l.dia, l.ano_liturgico]
          .filter(Boolean).join(' ').toLowerCase().includes(this.filtro)
      );
    }

    if (this.colunaOrdenada) {
      const col = this.colunaOrdenada;
      const dir = this.direcaoOrdenacao === 'asc' ? 1 : -1;
      lista = [...lista].sort((a, b) => {
        if (col === 'dia') {
          return (new Date(a.dia).getTime() - new Date(b.dia).getTime()) * dir;
        }
        const va = String((a as any)[col] ?? '').toLowerCase();
        const vb = String((b as any)[col] ?? '').toLowerCase();
        return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
      });
    }

    return lista;
  }

  totalPaginas(): number {
    return Math.max(1, Math.ceil(this.lecionariosFiltrados().length / this.itensPorPagina));
  }

  numerosPaginas(): number[] {
    return Array.from({ length: this.totalPaginas() }, (_, i) => i + 1);
  }

  lecionariosPaginados(): LecionarioResponse[] {
    const inicio = (this.pagina - 1) * this.itensPorPagina;
    return this.lecionariosFiltrados().slice(inicio, inicio + this.itensPorPagina);
  }

  mudarPagina(pag: number) {
    if (pag < 1 || pag > this.totalPaginas()) return;
    this.pagina = pag;
  }

  mudarTamanhoPagina() {
    this.pagina = 1;
  }

  editar(lecionario: any) {
    this.lecionarioService.setLecionarioSelecionado(lecionario);
    this.router.navigateByUrl('/lecionario/cadastro');
  }
  goToCadastro() {
    this.lecionarioService.setLecionarioSelecionado(null);
    this.router.navigateByUrl("/lecionario/cadastro")
  }

  async delete(id: string) {

    this.modalService.confirmar('Deseja realmente excluir este registro?').then(async (confirmado) => {
      if (confirmado) {
        // Usuário clicou em "Sim"
        const { error } = await this.supabaseService.deleteLectionary(id);
        if (error) {
          this.toast.erro('Erro ao excluir o registro.');
        } else {
          this.toast.sucesso('Registro excluído com sucesso!');

          this.recuperarLecionario();
        }

      } else {
        // Usuário clicou em "Não"
        console.log('Exclusão cancelada.');
      }
    });
  }

}