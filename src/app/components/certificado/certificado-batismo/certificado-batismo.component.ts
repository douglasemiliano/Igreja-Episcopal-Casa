import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CertificadoBatismoService } from '../../../services/certificados/certificado-batismo.service';
import { DadosCertificado } from '../../../model/certificado.model';
import { PdfViewerModalService } from '../certificado-confirmacao/pdf-viewer-modal/pdf-viewer-modal.service';
import { CommonModule } from '@angular/common';
import { CoreService } from '../../../services/core.service';

@Component({
  selector: 'app-certificado-batismo',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule],
  templateUrl: './certificado-batismo.component.html',
  styleUrl: './certificado-batismo.component.scss'
})
export class CertificadoBatismoComponent {
  formulario: FormGroup;
  currentStep = 1;
  ministros = [
    'Elton Nascimento',
    'Marcos Santos',
    'Bispo Hermany Soares',
    'Ielvys'
  ];

  private coreService: CoreService = inject(CoreService)
  isMobile: boolean = false;


  constructor(
    private fb: FormBuilder,
    private certificadoService: CertificadoBatismoService,
    private pdfViewer: PdfViewerModalService
  ) {
    this.formulario = this.fb.group({
      tipoPessoa: ['', Validators.required],
      nomeCompleto: ['', Validators.required],
      dataBatismo: ['', Validators.required],
      padrinhos: [],
      dataNascimento: [''],
      nomeMae:['',],
      nomePai:['',],
      numeroRegistro: [''],
      livroRegistro: [''],
      paginaRegistro: [''],
      localCelebracao: ['Rua Arão Lins de Andrade, 106, Jaboatão dos Guararapes 54310-335, PE'],
    });
    this.formulario.get('localCelebracao')?.disable();
    this.formulario.get('igrejaBatismo')?.disable();

    this.coreService.isMobile$.subscribe({
      next: (data) => {
        this.isMobile = data;        
      }
    })
  }

  nextStep() {
    if (this.currentStep < 4) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  async onSubmit() {
    if (this.formulario.valid) {
      const dados: DadosCertificado = {
        ...this.formulario.value,
        dataBatismo: new Date(this.formulario.value.dataBatismo),
        dataNascimento: this.formulario.value.dataNascimento ? 
                       new Date(this.formulario.value.dataNascimento) : undefined,
        padrinhos: this.formulario.value.padrinhos ? 
                  this.formulario.value.padrinhos.split(',').map((s: string) => s.trim()) : []
      };

      console.log(dados)
      
      try {
        const pdfBlob = await this.certificadoService.gerarCertificado(dados);
        const fileName = this.certificadoService.getNomeArquivo(dados.nomeCompleto);

        if (this.isMobile) {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(pdfBlob);
          link.download = fileName;
          link.click();
          URL.revokeObjectURL(link.href);
        } else {
          this.pdfViewer.abrir(pdfBlob, fileName);
        }
      } catch (error) {
        console.error('Erro ao gerar certificado:', error);
        alert('Erro ao gerar o certificado. Por favor, tente novamente.');
      }
    }
  }
}
