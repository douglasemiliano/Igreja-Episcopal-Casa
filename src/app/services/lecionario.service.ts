import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { LecionarioMock } from '../mocks/lecionario.mock';
import { Lecionario } from '../model/Lecionario.model';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LecionarioService {

  public dataUnica: WritableSignal<Date> = signal<Date>(new Date());
  public lecionarioSelecionado: WritableSignal<Lecionario> = signal<any>(null);
  private readonly http = inject(HttpClient)

  setLecionarioSelecionado(lecionario: Lecionario | null) {
    this.lecionarioSelecionado.set(lecionario!);
  }

  getConteudoPorData(date: Date) {
    if (!this.dataUnica) return;

    let data: string | Date = date;

    if (typeof date === 'object') {
      data = this.formatDate(date);
    }

    const ano = 'C'; // você pode tornar isso dinâmico se quiser
    const lecionario = LecionarioMock.find(l => l.ano === ano);

    const diaEncontrado = lecionario!.conteudo.find(item => item.dia === data);

    return diaEncontrado!;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]; // retorna yyyy-mm-dd
  }

fetchLecionado(data: Date): Observable<any> {
  // Formata a data para YYYY-MM-DD
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  const dataFormatada = `${ano}-${mes}-${dia}`;
  
  
  return this.http.get(`https://lectserve.com/date/${dataFormatada}?lect=rcl`);
}



}
