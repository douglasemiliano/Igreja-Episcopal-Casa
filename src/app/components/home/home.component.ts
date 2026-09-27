import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { PermissaoService } from '../../services/permissao.service';

/**
 * Central de atalhos.
 *
 * Os atalhos que exigem alguma coisa perguntam a capacidade correspondente,
 * e não a uma lista de papéis. É a mesma chave que protege a rota em
 * app.routes.ts, então atalho e rota não podem divergir.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  private readonly permissao = inject(PermissaoService);

  async ngOnInit(): Promise<void> {
    await this.permissao.carregar();
  }

  temPermissao(chave: string): boolean {
    return this.permissao.pode(chave);
  }
}