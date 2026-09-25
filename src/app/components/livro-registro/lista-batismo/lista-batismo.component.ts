import { Component, OnInit } from '@angular/core';
import { DadosBatismo, LivroBatismoService } from '../../../services/livro/livro-batismo.service';
import { RegistroBatismoService } from '../../../services/livros-registro/registro-batismo.service';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';


@Component({
  selector: 'app-lista-batismo',
  imports: [MatIconModule, RouterLink],
  templateUrl: './lista-batismo.component.html',
  styleUrl: './lista-batismo.component.scss'
})
export class ListaBatismoComponent implements OnInit {
  registros: DadosBatismo[] = [];
  livroSelecionado = '1'; // pode ser dinâmico, se quiser trocar de livro

  constructor(private registroService: RegistroBatismoService, private livroBatismoService: LivroBatismoService) {}

  ngOnInit(): void {
    this.carregarRegistros();
  }

  async carregarRegistros() {
    this.registros = await this.registroService.listarRegistros(this.livroSelecionado) || [];
  }

  async atualizar(registro: DadosBatismo) {
    const novoPastor = prompt('Atualizar pastor:', registro.pastor || '');
    if (novoPastor !== null) {
      await this.registroService.atualizarRegistro(registro.id!, { pastor: novoPastor });
      await this.carregarRegistros();
    }
  }

  async deletar(id: string) {
    if (confirm('Deseja realmente deletar este registro?')) {
      await this.registroService.deletarRegistro(id);
      await this.carregarRegistros();
    }
  }

  async gerarFolha(dados: DadosBatismo){
    console.log(dados)
    const blob = await this.livroBatismoService.gerarDocumento(dados);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.livroBatismoService.getNomeArquivo(dados.nome_irmao!);
    a.click();
    URL.revokeObjectURL(url);
  }

  async gerarLivroCompleto() {
    if (this.registros.length === 0) {
      alert('Não há registros para gerar o livro.');
      return;
    }
    const blob = await this.livroBatismoService.gerarLivroCompleto(this.registros);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `livro-batismo-completo-livro-${this.livroSelecionado}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }
  

}