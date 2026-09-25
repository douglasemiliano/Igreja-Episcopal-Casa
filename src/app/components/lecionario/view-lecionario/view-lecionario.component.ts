import { Component, ElementRef, inject, ViewChild } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { HttpClient } from '@angular/common/http';
import { SupabaseService } from '../../../services/supabase.service';
import { LecionarioService } from '../../../services/lecionario.service';
import { Conteudo } from '../../../model/Lecionario.model';

@Component({
  selector: 'app-lecionario',
  imports: [FormsModule, CommonModule, DatePipe, MatIconModule],
  templateUrl: './view-lecionario.component.html',
  styleUrl: './view-lecionario.component.scss',
  standalone: true
})
export class ViewLecionarioComponent {
  selected: any;
  private lecionarioService: LecionarioService = inject(LecionarioService)
  private supabaseService = inject(SupabaseService);

  dataUnica: Date = this.lecionarioService.dataUnica();

  conteudoLecionario: Conteudo | null = null;

  @ViewChild('dateModal') dateModal!: ElementRef<HTMLDivElement>;

  private modal: any;
  dataInput = '';

  descricaoLecionario: string = "Esta ferramenta é organizada para nos conduzir a uma vida de disciplina espiritual e desfrutar do livre acesso proporcionado pela obra de Cristo. Não se trata apenas de interpretar textos, mas de aprender a ouvir Deus falar diretamente com você através da oração e leitura bíblica."
  liturgiaDiariaTitulo: string = "Liturgia Diária"

  liturgiaDiaria: string[] = ["Inicie com uma oração, pedindo ao Senhor que fale através de Sua Palavra e prepare seu coração para desfrutar de Sua presença.",
    "Faça uma ou todas as leituras indicadas (podendo usar as leituras em mais de um momento durante o dia, desde que se faça todas as leituras).",
    "Ouça ou cante um louvor.",
    "Conclua com a oração diária, utilizando-a como guia para refletir sobre o que buscar nesse momento."
  ]

  // Dicionário de tradução dos livros da Bíblia (Inglês -> Português)
private readonly LIVROS_MAP: { [key: string]: string } = {
  'Genesis': 'Gênesis', 'Exodus': 'Êxodo', 'Leviticus': 'Levítico', 'Numbers': 'Números', 'Deuteronomy': 'Deuteronômio',
  'Joshua': 'Josué', 'Judges': 'Juízes', 'Ruth': 'Rute', '1 Samuel': '1 Samuel', '2 Samuel': '2 Samuel',
  '1 Kings': '1 Reis', '2 Kings': '2 Reis', '1 Chronicles': '1 Crônicas', '2 Chronicles': '2 Crônicas',
  'Ezra': 'Esdras', 'Nehemiah': 'Neemias', 'Esther': 'Ester', 'Job': 'Jó', 'Psalms': 'Salmos', 'Psalm': 'Salmo',
  'Proverbs': 'Provérbios', 'Ecclesiastes': 'Eclesiastes', 'Song of Songs': 'Cântico dos Cânticos', 'Song of Solomon': 'Cântico dos Cânticos',
  'Isaiah': 'Isaías', 'Jeremiah': 'Jeremias', 'Lamentations': 'Lamentações', 'Ezekiel': 'Ezequiel', 'Daniel': 'Daniel',
  'Hosea': 'Oseias', 'Joel': 'Joel', 'Amos': 'Amós', 'Obadiah': 'Obadias', 'Jonah': 'Jonas', 'Micah': 'Miqueias',
  'Nahum': 'Naum', 'Habakkuk': 'Habacuque', 'Zephaniah': 'Sofonias', 'Haggai': 'Ageu', 'Zechariah': 'Zacarias', 'Malachi': 'Malaquias',
  'Matthew': 'Mateus', 'Mark': 'Marcos', 'Luke': 'Lucas', 'John': 'João', 'Acts': 'Atos',
  'Romans': 'Romanos', '1 Corinthians': '1 Coríntios', '2 Corinthians': '2 Coríntios', 'Galatians': 'Gálatas',
  'Ephesians': 'Efésios', 'Philippians': 'Filipenses', 'Colossians': 'Colossenses', '1 Thessalonians': '1 Tessalonicenses',
  '2 Thessalonians': '2 Tessalonicenses', '1 Timothy': '1 Timóteo', '2 Timothy': '2 Timóteo', 'Titus': 'Tito',
  'Philemon': 'Filemon', 'Hebrews': 'Hebreus', 'James': 'Tiago', '1 Peter': '1 Pedro', '2 Peter': '2 Pedro',
  '1 John': '1 João', '2 John': '2 João', '3 John': '3 João', 'Jude': 'Judas', 'Revelation': 'Apocalipse'
};

// Função que identifica o livro em inglês na string e substitui pelo nome em português
traduzirTextoBiblico(textoIngles: string): string {
  if (!textoIngles) return '';
  
  // Ordena as chaves por tamanho decrescente para evitar que "1 John" seja pego parcialmente por "John"
  const chavesOrdenadas = Object.keys(this.LIVROS_MAP).sort((a, b) => b.length - a.length);
  
  for (const livroIngles of chavesOrdenadas) {
    if (textoIngles.toLowerCase().startsWith(livroIngles.toLowerCase())) {
      const livroPortugues = this.LIVROS_MAP[livroIngles];
      // Substitui apenas o nome do livro, mantendo o restante da referência (capítulos e versículos) intactos
      return textoIngles.replace(new RegExp(livroIngles, 'i'), livroPortugues);
    }
  }
  
  return textoIngles; // Caso não encontre no mapa, retorna o texto original com segurança
}


  constructor(private http: HttpClient) { }

  ngOnInit() {
    this.getConteudoLecionario();
  }

  getConteudoLecionario(): void {
    this.lecionarioService.fetchLecionado(this.dataUnica).subscribe({
      next: (respostaApi: any) => {
        if (!respostaApi || !respostaApi.daily) {
          this.conteudoLecionario = null;
          return;
        }

        const daily = respostaApi.daily;
        const readings = daily.readings;
        const leiturasMapeadas: { tipo: string; texto: string }[] = [];

        // 1. Mapeia com segurança as leituras da manhã (Morning)
        if (readings?.morning) {
          if (readings.morning.first) leiturasMapeadas.push({ tipo: 'Manhã (Primeira)', texto: this.traduzirTextoBiblico(readings.morning.first) });
          if (readings.morning.second) leiturasMapeadas.push({ tipo: 'Manhã (Segunda)', texto: this.traduzirTextoBiblico(readings.morning.second) });
        }

        // 2. Mapeia com segurança as leituras da noite (Evening)
        if (readings?.evening) {
          if (readings.evening.first) leiturasMapeadas.push({ tipo: 'Noite (Primeira)', texto: this.traduzirTextoBiblico(readings.evening.first) });
          if (readings.evening.second) leiturasMapeadas.push({ tipo: 'Noite (Segunda)', texto: this.traduzirTextoBiblico(readings.evening.second) });
        }

        // 3. Se houver uma festa (red_letter) com leituras específicas, nós as incluímos
        if (respostaApi.red_letter?.services && respostaApi.red_letter.services.length > 0) {
          const servicoFesta = respostaApi.red_letter.services[0]; // Pega a primeira variação da festa
          if (servicoFesta.readings) {
            servicoFesta.readings.forEach((leituraFesta: string, idx: number) => {
              leiturasMapeadas.push({
                tipo: `Festa (${servicoFesta.name} - Leit. ${idx + 1})`,
                texto: this.traduzirTextoBiblico(leituraFesta)  
              });
            });
          }
        }

        // 4. Se for um domingo (sunday) e não houver leituras diárias, adiciona as de domingo
        if (leiturasMapeadas.length === 0 && respostaApi.sunday?.services?.length > 0) {
          const servicoDomingo = respostaApi.sunday.services[0];
          if (servicoDomingo.readings) {
            servicoDomingo.readings.forEach((leituraDom: string, idx: number) => {
              leiturasMapeadas.push({
                tipo: `Domingo (${servicoDomingo.name})`,
                texto: this.traduzirTextoBiblico(leituraDom)
              });
            });
          }
        }

        // 5. Monta o objeto final incluindo a propriedade 'dia' exigida pela sua Model
        const nomeExibicao = respostaApi.red_letter?.services?.length > 0
          ? respostaApi.red_letter.services[0].name
          : (respostaApi.sunday?.services?.length > 0 ? respostaApi.sunday.services[0].name : daily.day);

        this.conteudoLecionario = {
          nome: nomeExibicao,
          tempo: daily.week || "Tempo Comum",
          dia: daily.date || this.dataUnica.toISOString().split('T')[0], // ✨ Adicionado aqui (usa o formato YYYY-MM-DD da API)
          leituras: leiturasMapeadas,
          oracoes: [
            "Inicie com uma oração silenciosa entregando seu dia ao Senhor.",
            "Medite nos textos bíblicos sugeridos e aplique-os ao seu coração.",
            "Finalize agradecendo pelas revelações trazidas pela palavra de hoje."
          ]
        };
      },
      error: (err) => {
        console.error("Erro ao buscar dados do lecionário externo:", err);
        this.conteudoLecionario = null;
      }
    });
  }


  primeiraLetraMaiuscula(nome: string) {
    return nome.charAt(0).toUpperCase() + nome.substring(1);
  }

  incrementarDecrementarDia(increment: boolean): void {
    const dataAtual = this.dataUnica; // lê o valor atual
    const novaData = new Date(dataAtual); // cria uma nova cópia da data
    if (increment) {
      novaData.setDate(novaData.getDate() + 1); // incrementa 1 dia
    } else {
      novaData.setDate(novaData.getDate() - 1); // decrementa 1 dia
    }
    this.dataUnica = novaData; // atualiza o signal

    this.lecionarioService.dataUnica.set(this.dataUnica);
    this.getConteudoLecionario();

  }

  onSelect(event: any) {
    this.dataUnica = event;
    this.lecionarioService.dataUnica.set(this.dataUnica);
    this.getConteudoLecionario();
    this.fecharCalendario();
  }

  private toISODate(data: Date): string {
    const y = data.getFullYear();
    const m = String(data.getMonth() + 1).padStart(2, '0');
    const d = String(data.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  abrirCalendario(): void {
    this.dataInput = this.toISODate(this.dataUnica);
    const Bootstrap = (window as any).bootstrap;
    if (!Bootstrap) return;
    this.modal = new Bootstrap.Modal(this.dateModal.nativeElement);
    this.modal.show();
  }

  fecharCalendario(): void {
    this.modal?.hide();
  }

  onDataInputChange(): void {
    const valor = this.dataInput;
    if (!valor) return;
    this.onSelect(new Date(valor + 'T00:00:00'));
  }

  formatarTexto() {
    let texto: string = `${this.negritoWhatsapp(this.conteudoLecionario?.tempo + " - Dia: " + this.dataUnica.toLocaleDateString())}
    \n${this.negritoWhatsapp(this.conteudoLecionario?.nome!)}
    \n${this.descricaoLecionario}
    \n${this.negritoWhatsapp(this.liturgiaDiariaTitulo)}
    \n${this.liturgiaDiaria.map((item, index) => `${index + 1}. ${item}`).join("\n")}
    \n${this.negritoWhatsapp("Textos Bíblicos")}
    \n${this.conteudoLecionario!.leituras.map((leitura: any) => `${this.primeiraLetraMaiuscula(leitura.tipo)}: ${leitura.texto}`).join("\n\n")}
    \n${this.negritoWhatsapp("Orações para o dia:")}
    \n${this.conteudoLecionario!.oracoes.map((oracao: any, index: number, arr: any[]) => index < arr.length - 1 ? `${oracao}\n\nou` : oracao).join("\n\n")}
    `;

    navigator.clipboard.writeText(texto).then(() => {
      alert('Lecionário copiado para a área de transferência!');
    }).catch(err => {
      console.error('Erro ao copiar o texto: ', err);
    });

  }

  negritoWhatsapp(text: string): string {
    return `*${text}*`;
  }

}
