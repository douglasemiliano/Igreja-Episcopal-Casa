import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { SupabaseService } from '../../../services/supabase.service';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-cadastrar-membro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './cadastrar-membro.component.html',
  styleUrl: './cadastrar-membro.component.scss'
})
export class CadastrarMembroComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  fb = inject(FormBuilder);
  toast = inject(ToastService);
  router = inject(Router);

  membroForm: FormGroup;
  currentStep = 1;

  ngOnInit(): void {
    this.membroForm = this.fb.group({
      pessoais: this.fb.group({
        nome_completo: ['', Validators.required],
        email: ['', [Validators.email]],
        telefone: [''],
      }),
      adicionais: this.fb.group({
        data_nascimento: [''],
        sexo: [''],
        endereco: [''],
      }),
      igreja: this.fb.group({
        funcao: [''],
        data_entrada: ['']
      })
    });
  }

  nextStep() {
    if (this.currentStep === 1 && this.pessoais.invalid) {
      this.pessoais.markAllAsTouched();
      this.toast.mostrar('Por favor, preencha os campos obrigatórios.');
      return;
    }
    if (this.currentStep < 3) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  get pessoais() {
    return this.membroForm.get('pessoais') as FormGroup;
  }

  get adicionais() {
    return this.membroForm.get('adicionais') as FormGroup;
  }

  get igreja() {
    return this.membroForm.get('igreja') as FormGroup;
  }

  async criarMembro() {
    if (this.membroForm.valid) {
      try {
        const { pessoais, adicionais, igreja } = this.membroForm.value;
        const membroData = { ...pessoais, ...adicionais, ...igreja };

        // O formulário deixa os campos opcionais como string vazia. Mandar ''
        // para uma coluna date/text é erro de dado no Postgres, não de
        // permissão: '' não converte em data (SQLSTATE 22P02) e o PostgREST
        // responde 400. Campo não preenchido vai como null, que é o que a
        // coluna nullable espera.
        for (const campo of ['email', 'telefone', 'data_nascimento', 'sexo', 'endereco', 'funcao', 'data_entrada']) {
          if (membroData[campo] === '') {
            membroData[campo] = null;
          }
        }

        // O supabase-js resolve { data, error } e NÃO lança. Sem destruturar o
        // error, o catch nunca dispara e a tela anunciava "Membro criado com
        // sucesso!" com a API respondendo 400 e nada gravado.
        const { error } = await this.supabaseService.addMembro(membroData);

        if (error) {
          console.error('Erro ao criar membro:', error);
          this.toast.erro(this.mensagemDeErro(error));
          return;
        }

        this.toast.sucesso('Membro criado com sucesso!');
        this.membroForm.reset();
        this.currentStep = 1;
        this.router.navigate(['/membros']);
      } catch (error) {
        console.error(error);
        this.toast.erro('Erro ao criar membro.');
      }
    } else {
      this.membroForm.markAllAsTouched();
      this.toast.mostrar('Preencha todos os campos obrigatórios.');
    }
  }

  /**
   * 400 é erro de dado, não de permissão: campo que o Postgres não consegue
   * converter, ou que violou uma restrição. O corpo do erro diz qual — e
   * "erro genérico" só faz a pessoa repetir o cadastro sem mudar nada.
   */
  private mensagemDeErro(error: { message: string; code?: string; details?: string }): string {
    const texto = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();

    if (texto.includes('invalid input syntax') && texto.includes('date')) {
      return 'Uma das datas não é válida.';
    }
    if (texto.includes('duplicate key')) {
      return 'Já existe um registro com esse e-mail.';
    }
    if (texto.includes('row-level security') || texto.includes('42501')) {
      return 'Você não tem permissão para cadastrar membros.';
    }
    if (texto.includes('null value in column')) {
      return 'Falta um campo obrigatório no banco de dados.';
    }
    if (texto.includes('violates check constraint')) {
      return 'Um dos valores enviados não é aceito.';
    }

    return 'Erro ao criar membro. Tente novamente.';
  }
}