import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, inject, Input, OnDestroy, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { CoreService } from '../../../services/core.service';
import { MenuItem, MenuService } from '../../../services/menu.service';

/**
 * Busca do menu, usada no sidebar e no header com o mesmo comportamento:
 * digita, vê os itens liberados para o seu perfil e navega.
 *
 * Só o modo do painel muda entre os dois lugares — `inline` encaixa no
 * fluxo (o sidebar recorta o que sai das suas caixas) e o padrão flutua
 * por cima (header).
 */
@Component({
  selector: 'app-searchbar',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, RouterModule],
  templateUrl: './searchbar.component.html',
  styleUrl: './searchbar.component.scss'
})
export class SearchbarComponent implements OnDestroy {
  private readonly menu = inject(MenuService);
  private readonly core = inject(CoreService);
  private readonly router = inject(Router);
  private readonly elementRef = inject(ElementRef);

  @Input() placeholder = 'Buscar no menu...';
  @Input() inline = false;

  @Input() termo = '';
  @Output() termoChange = new EventEmitter<string>();

  /** Emite o destino escolhido, para o sidebar fechar no mobile. */
  @Output() navegou = new EventEmitter<string>();

  resultados: MenuItem[] = [];
  indiceAtivo = -1;
  painelAberto = false;
  roles: string[] = ['membro'];

  private readonly inscricao: Subscription;

  constructor() {
    // Os perfis chegam pelo CoreService (header e sidebar alimentam o mesmo
    // subject), então a busca respeita a permissão sem repetir a consulta.
    this.inscricao = this.core.usuario$.subscribe({
      next: (usuario) => {
        this.roles = usuario.roles;
        this.recalcular();
      }
    });
  }

  ngOnDestroy(): void {
    this.inscricao.unsubscribe();
  }

  aoDigitar(valor: string): void {
    this.termo = valor ?? '';
    this.termoChange.emit(this.termo);
    this.painelAberto = !!this.termo.trim();
    this.recalcular();
  }

  limpar(): void {
    this.aoDigitar('');
  }

  /**
   * @param navegar true quando a escolha veio do teclado — no clique o
   * routerLink do próprio item já faz o caminho.
   */
  selecionar(item: MenuItem, navegar: boolean): void {
    if (navegar) {
      this.router.navigateByUrl(item.path);
    }

    this.painelAberto = false;
    this.termo = '';
    this.termoChange.emit('');
    this.navegou.emit(item.path);
  }

  aoTeclar(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.termo ? this.limpar() : (this.painelAberto = false);
      return;
    }

    if (!this.painelAberto || !this.resultados.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.indiceAtivo = (this.indiceAtivo + 1) % this.resultados.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.indiceAtivo = (this.indiceAtivo - 1 + this.resultados.length) % this.resultados.length;
    } else if (event.key === 'Enter' && this.indiceAtivo >= 0) {
      event.preventDefault();
      this.selecionar(this.resultados[this.indiceAtivo], true);
    }
  }

  private recalcular(): void {
    this.resultados = this.menu.buscar(this.roles, this.termo);
    this.indiceAtivo = this.resultados.length ? 0 : -1;
  }

  /** Clique fora do componente fecha o painel. */
  @HostListener('document:click', ['$event'])
  aoClicarFora(event: MouseEvent): void {
    if (!this.painelAberto) return;

    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.painelAberto = false;
    }
  }

  @HostListener('document:keydown.escape')
  aoEscapar(): void {
    this.painelAberto = false;
  }
}
