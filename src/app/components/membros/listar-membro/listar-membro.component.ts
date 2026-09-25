import { Component, inject, OnInit } from '@angular/core';
import { SupabaseService } from '../../../services/supabase.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-listar-membro',
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule],
  templateUrl: './listar-membro.component.html',
  styleUrl: './listar-membro.component.scss'
})
export class ListarMembrosComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  membros: any[] = [];
  confirmacoes: { [key: string]: any[] } = {};
  roles: string[] = ['membro'];

  filtro = '';
  pagina = 1;
  itensPorPagina = 10;
  opcoesPagina = [5, 10, 20, 50];

  ngOnInit() {
    this.supabaseService.getRoles().then((roles) => { this.roles = roles; });
    this.carregarMembros();
  }

  temPermissao(roles: string[]): boolean {
    return roles.some((role) => this.roles.includes(role));
  }


  async carregarMembros() {
    try {
      const { data, error } = await this.supabaseService.getMembrosComConfirmacao();
      if (error) throw error;
      this.membros = data || [];

      this.pagina = 1;

      // Inicializa confirmacoes com arrays vazios para cada membro
      for (let membro of this.membros) {
        const { data: confs, error: err } = await this.supabaseService.getConfirmacoesPorMembro(membro.id);
        if (err) console.error(err);
        this.confirmacoes[membro.id] = confs || []; // nunca undefined
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao carregar membros.');
    }
  }

  applyFilter(event: Event) {
    this.filtro = (event.target as HTMLInputElement).value.trim().toLowerCase();
    this.pagina = 1;
  }

  membrosFiltrados(): any[] {
    const termo = this.filtro;
    if (!termo) return this.membros;
    return this.membros.filter(m =>
      [m.nome_completo, m.email, m.telefone, m.funcao]
        .filter(Boolean).join(' ').toLowerCase().includes(termo)
    );
  }

  totalPaginas(): number {
    return Math.max(1, Math.ceil(this.membrosFiltrados().length / this.itensPorPagina));
  }

  numerosPaginas(): number[] {
    return Array.from({ length: this.totalPaginas() }, (_, i) => i + 1);
  }

  membrosPaginados(): any[] {
    const inicio = (this.pagina - 1) * this.itensPorPagina;
    return this.membrosFiltrados().slice(inicio, inicio + this.itensPorPagina);
  }

  mudarPagina(pag: number) {
    if (pag < 1 || pag > this.totalPaginas()) return;
    this.pagina = pag;
  }

  mudarTamanhoPagina() {
    this.pagina = 1;
  }

  async confirmarMembro(membro: any) {
    const dadosConfirmacao = {
      data_confirmacao: new Date(),
      oficiante: 'Hermany Soares', // você pode deixar para preencher dinamicamente
      observacoes: ''
    };

    try {
      await this.supabaseService.confirmarMembro(membro.id, dadosConfirmacao);
      alert(`Membro ${membro.nome_completo} confirmado com sucesso!`);
      this.carregarMembros(); // Atualiza lista de confirmações
    } catch (err) {
      console.error(err);
      alert('Erro ao confirmar membro.');
    }
  }

  deletarMembro(membro: any): void {
    if (confirm(`Tem certeza que deseja deletar o membro ${membro.nome_completo}?`)) {
      this.supabaseService.deleteMembro(membro.id).then(({ error }) => {
        if (!error) {
          // remove da lista sem precisar recarregar tudo
          this.membros = this.membros.filter(m => m.id !== membro.id);
        } else {
          console.error('Erro ao deletar:', error);
        }
      });
    }
  }

}