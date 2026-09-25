import { Component, inject, OnInit } from '@angular/core';
import { DadosBatismo, LivroBatismoService } from '../../../services/livro/livro-batismo.service';
import { RegistroBatismoService } from '../../../services/livros-registro/registro-batismo.service';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { UtilitariosService } from '../../../services/utilitarios.service';

@Component({
  selector: 'app-registro-batismo',
  imports: [FormsModule, ReactiveFormsModule, CommonModule],
  templateUrl: './registro-batismo.component.html',
  styleUrl: './registro-batismo.component.scss'
})
export class RegistroBatismoComponent implements OnInit {

  private registroService: RegistroBatismoService = inject(RegistroBatismoService);
  private router: Router = inject(Router);
  private utilsService: UtilitariosService = inject(UtilitariosService);



  constructor(private livroService: LivroBatismoService, private fb: FormBuilder) { }

  livroSelecionado = '1'; // exemplo: Livro 1
  registros: DadosBatismo[] = [];
  dados: DadosBatismo = {};
  batismoForm!: FormGroup;
  currentStep = 1;


  ngOnInit(): void {
    this.batismoForm = this.fb.group({
      nome_irmao: ['', Validators.required],
      data_nascimento: ['', Validators.required],
      nacionalidade: ['', Validators.required],
      pai: ['', Validators.required],
      mae: ['', Validators.required],
      padrinho: ['', Validators.required],
      madrinha: ['', Validators.required],
      data_batismo: ['', Validators.required],
      pastor: ['', Validators.required],
      secretario: ['', Validators.required],
      livro: [this.livroSelecionado],
      pagina: [null],
      rua: ['', Validators.required],
      numero_endereco: ['', Validators.required],
      complemento: ['', Validators.required],
      bairro: ['', Validators.required],
      cidade: ['', Validators.required],
      estado: ['', Validators.required],
      cep: ['', Validators.required, Validators.maxLength(8), Validators.minLength(8) ],
    });

    this.carregarRegistros();
  }

  nextStep() {
    if (this.currentStep < 3) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  get step1Invalid() {
    const step1Controls = ['nome_irmao', 'data_nascimento', 'pai', 'mae'];
    return step1Controls.some(name => this.batismoForm.get(name)?.invalid);
  }

  get step2Invalid() {
    const step2Controls = ['padrinho', 'madrinha', 'data_batismo', 'pastor', 'secretario'];
    return step2Controls.some(name => this.batismoForm.get(name)?.invalid);
  }

  async carregarRegistros() {
    this.registros = await this.registroService.listarRegistros(this.livroSelecionado) || [];
  }

  async adicionar() {
    if (this.batismoForm.invalid) {
      this.batismoForm.markAllAsTouched();
      return;
    }

    await this.registroService.adicionarRegistro(this.livroSelecionado, this.batismoForm.value).then( () => {
      this.batismoForm.reset({ livro: this.livroSelecionado }); // resetar mantendo o livro
      this.router.navigateByUrl('/livro/batismo');
    });
    await this.carregarRegistros();
  }

  async atualizar(id: string) {
    // Exemplo: atualizar apenas pastor
    await this.registroService.atualizarRegistro(id, { pastor: 'Novo Pastor' });
    await this.carregarRegistros();
  }

  async deletar(id: string) {
    if (confirm('Deseja realmente deletar este registro?')) {
      await this.registroService.deletarRegistro(id);
      await this.carregarRegistros();
    }
  }


  async baixarPdf() {
    const dados: DadosBatismo = {
      numero_registro: 1,
      nome_irmao: 'João da Silva',
      data_nascimento: '01/01/2020',
      cidade: 'João Pessoa',
      estado: 'PB',
      pai: 'Carlos Silva',
      mae: 'Maria Silva',
      padrinho: '',
      madrinha: '',
      rua: 'Rua das Flores',
      numero_endereco: '100',
      bairro: 'Centro',
      cep: '58000-000',
      data_batismo: '15/09/2025',
      pastor: 'Pastor José',
      secretario: 'Secretário Pedro',
      pais: 'Brasil',
      livro: '1',
      pagina: '1',
    };

    const blob = await this.livroService.gerarDocumento(dados);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.livroService.getNomeArquivo(dados.nome_irmao!);
    a.click();
    URL.revokeObjectURL(url);
  }

  consultarCep(cep: any) {
    if(cep.value.length === 8)
    this.utilsService.consultarCep(cep.value).subscribe({
      next: (dados: any) => {
        this.batismoForm.patchValue({
          cidade: dados.city,
          estado: dados.state,
          bairro: dados.neighborhood,
          rua: dados.street,
          pais: dados.country
        })
      }
    })
  }
}
