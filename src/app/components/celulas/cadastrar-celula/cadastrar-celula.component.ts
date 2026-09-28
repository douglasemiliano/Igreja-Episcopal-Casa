import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CelulaService } from '../../../services/celula.service';
import { ToastService } from '../../../services/toast.service';
import { DadosCelula } from '../../../model/celula.model';

/**
 * Cadastro e edição de célula no mesmo formulário.
 *
 * São duas rotas e um componente: `/celulas/cadastrar` e
 * `/celulas/:id/editar`. Separar em dois arquivos duplicaria os campos e a
 * validação do nome, e o que muda entre os dois casos é só se existe id.
 */
@Component({
  selector: 'app-cadastrar-celula',
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule],
  templateUrl: './cadastrar-celula.component.html',
  styleUrl: './cadastrar-celula.component.scss'
})
export class CadastrarCelulaComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly celulasService = inject(CelulaService);
  private readonly toast = inject(ToastService);

  readonly editando = signal<boolean>(false);
  readonly carregando = signal<boolean>(false);
  readonly salvando = signal<boolean>(false);

  readonly celulaId = signal<string | null>(null);
  readonly form = signal<DadosCelula>({
    nome: '',
    descricao: '',
    dia_semana: '',
    local: '',
    horario: '',
    ativa: true
  });

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');

    if (!id) {
      return;
    }

    this.editando.set(true);
    this.celulaId.set(id);
    this.carregando.set(true);

    try {
      const { celula } = await this.celulasService.detalhe(id);
      this.form.set({
        nome: celula.nome,
        descricao: celula.descricao ?? '',
        dia_semana: celula.dia_semana ?? '',
        local: celula.local ?? '',
        // O banco devolve `HH:MM:SS` e o input type="time" quer `HH:MM`.
        horario: celula.horario ? celula.horario.slice(0, 5) : '',
        ativa: celula.ativa
      });
    } catch (falha) {
      this.toast.erro(falha instanceof Error ? falha.message : 'Não foi possível abrir a célula.');
      await this.router.navigate(['/celulas']);
    } finally {
      this.carregando.set(false);
    }
  }

  atualizar(campo: keyof DadosCelula, valor: string | boolean): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  async salvar(): Promise<void> {
    if (this.salvando()) return;

    this.salvando.set(true);
    try {
      const resultado = await this.celulasService.salvar(this.form(), this.celulaId());
      if (resultado.status === 'erro') {
        this.toast.erro(resultado.mensagem ?? 'Não foi possível salvar.');
        return;
      }

      this.toast.sucesso(this.editando() ? 'Célula atualizada.' : 'Célula cadastrada.');

      // Criar vai para o detalhe: é onde a célula ganha membros, e voltar à
      // listagem deixaria a pessoa procurando onde colocá-los.
      await this.router.navigate(resultado.id ? ['/celulas', resultado.id] : ['/celulas']);
    } finally {
      this.salvando.set(false);
    }
  }

  cancelar(): void {
    const id = this.celulaId();
    this.router.navigate(id ? ['/celulas', id] : ['/celulas']);
  }
}
