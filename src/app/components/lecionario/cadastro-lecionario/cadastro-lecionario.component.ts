import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { SupabaseService } from '../../../services/supabase.service';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { LecionarioService } from '../../../services/lecionario.service';
import { Router } from '@angular/router';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-cadastro-lecionario',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatIconModule
  ],
  templateUrl: './cadastro-lecionario.component.html',
  styleUrl: './cadastro-lecionario.component.scss'
})
export class CadastroLecionarioComponent implements OnInit, OnDestroy {
 lecionarioParaEditar: any = null;
  form: FormGroup;
  isEditMode = false;

  constructor(
    private fb: FormBuilder,
    private supabaseService: SupabaseService,
    private toast: ToastService,
    private lecionarioService: LecionarioService,
    private router: Router
  ) {
    this.form = this.fb.group({
      ano_liturgico: ['C', Validators.required],
      tempo: ['', Validators.required],
      dia: ['', Validators.required],
      nome: ['', Validators.required],
      oracoes: this.fb.array([this.fb.control('', Validators.required)]),
      leituras: this.fb.array([this.createLeituraFormGroup()])
    });
  }

  ngOnInit() {
    this.lecionarioParaEditar =  this.lecionarioService.lecionarioSelecionado();
    if (this.lecionarioParaEditar) {
      this.isEditMode = true;
      this.populateForm(this.lecionarioParaEditar);
    }
  }


  ngOnDestroy(){
    this.lecionarioService.setLecionarioSelecionado(null);
  }

  populateForm(data: any) {
    this.form.addControl('id', this.fb.control(data.id));
    this.form.patchValue({
      id: data.id,
      ano_liturgico: data.ano_liturgico,
      tempo: data.tempo,
      dia: this.toISODate(data.dia),
      nome: data.nome
    });

    this.form.setControl(
      'oracoes',
      this.fb.array(data.oracoes.map((o: string) => this.fb.control(o, Validators.required)))
    );

    this.form.setControl(
      'leituras',
      this.fb.array(data.leituras.map((l: any) =>
        this.fb.group({
          tipo: [l.tipo, Validators.required],
          texto: [l.texto, Validators.required]
        })
      ))
    );
  }

  get oracoes(): FormArray {
    return this.form.get('oracoes') as FormArray;
  }

  get leituras(): FormArray {
    return this.form.get('leituras') as FormArray;
  }

  addOracao() {
    this.oracoes.push(this.fb.control('', Validators.required));
  }

  removeOracao(index: number) {
    this.oracoes.removeAt(index);
  }

  addLeitura() {
    this.leituras.push(this.createLeituraFormGroup());
  }

  removeLeitura(index: number) {
    this.leituras.removeAt(index);
  }

  createLeituraFormGroup(): FormGroup {
    return this.fb.group({
      tipo: ['', Validators.required],
      texto: ['', Validators.required]
    });
  }

  private toISODate(valor: any): string {
    if (!valor) return '';
    if (valor instanceof Date) {
      const y = valor.getFullYear();
      const m = String(valor.getMonth() + 1).padStart(2, '0');
      const d = String(valor.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(valor).slice(0, 10);
  }

  async submit() {
    if (this.form.valid) {
      const data = { ...this.form.value, dia: this.toISODate(this.form.value.dia) };

      if (this.isEditMode) {
        const { error } = await this.supabaseService.updateLectionary(data.id, data);
        if (error) {
          this.toast.erro('Erro ao atualizar registro.');
        } else {
          this.toast.sucesso('Registro atualizado com sucesso!');
        }
      } else {
        const { error } = await this.supabaseService.insertLectionary(data);
        if (error && error.details?.includes("already exists")) {
          this.toast.erro('Já existe um registro para esse dia. Por favor, escolha outra data.');
          return;
        }

        if (error) {
          this.toast.erro('Erro ao cadastrar registro.');
          return;
        }

        this.toast.sucesso('Registro cadastrado com sucesso!');

        this.form.reset();
        this.form.setControl('oracoes', this.fb.array([this.fb.control('')]));
        this.form.setControl('leituras', this.fb.array([this.createLeituraFormGroup()]));
      }

      this.router.navigateByUrl("listar-lecionario")
    }
  }
}