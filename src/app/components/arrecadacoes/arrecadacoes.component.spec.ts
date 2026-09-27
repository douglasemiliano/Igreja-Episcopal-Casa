import { TestBed } from '@angular/core/testing';

import { RelatorioCaixaService } from '../../services/relatorio-caixa.service';
import { SupabaseService } from '../../services/supabase.service';
import { ArrecadacoesComponent } from './arrecadacoes.component';

const CAIXA_ATUAL = 'caixa-1';
const CAIXA_ANTERIOR = 'caixa-0';
const FERNANDA = 'membro-fernanda';
const JOAO = 'membro-joao';

describe('ArrecadacoesComponent: conta de fiado', () => {
  let component: ArrecadacoesComponent;

  const venda = (
    id: string,
    membroId: string,
    valor: number,
    overrides: Record<string, unknown> = {}
  ): any => ({
    id: `item-${id}`,
    venda_id: `venda-${id}`,
    caixa_id: CAIXA_ATUAL,
    categoria: 'bazar',
    descricao: `item ${id}`,
    quantidade: 1,
    valor_unitario: valor,
    valor_total: valor,
    forma_pagamento: 'fiado',
    status: 'pendente',
    data_venda: `2026-09-2${id}T12:00:00.000Z`,
    membro_id: membroId,
    membro: { id: membroId, nome_completo: membroId === FERNANDA ? 'Fernanda' : 'João' },
    ...overrides
  });

  /** Um item da venda `vendaId`, para quando a mesma venda tem vários itens. */
  const item = (vendaId: string, id: string, overrides: Record<string, unknown> = {}): any => ({
    ...venda(id, FERNANDA, 10),
    id: `item-${id}`,
    venda_id: vendaId,
    ...overrides
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ArrecadacoesComponent,
        { provide: SupabaseService, useValue: {} },
        { provide: RelatorioCaixaService, useValue: {} }
      ]
    });
    component = TestBed.inject(ArrecadacoesComponent);
    component.historicoCaixas = [
      { id: CAIXA_ATUAL, status: 'aberto', aberto_por: 'u1', aberto_em: '2026-09-20T12:00:00.000Z', valor_abertura: 0 }
    ];
  });

  it('junta dois fiados da mesma pessoa numa conta só', () => {
    component.arrecadacoes = [venda('1', FERNANDA, 30), venda('2', FERNANDA, 20)];

    expect(component.contasMembro.length).toBe(1);
    expect(component.contasMembro[0].membro).toBe('Fernanda');
    expect(component.contasMembro[0].total).toBe(50);
    expect(component.contasMembro[0].vendas.length).toBe(2);
    expect(component.contasMembro[0].vendaIds).toEqual(['venda-1', 'venda-2']);
  });

  it('mantém uma conta por pessoa', () => {
    component.arrecadacoes = [venda('1', FERNANDA, 30), venda('2', FERNANDA, 20), venda('3', JOAO, 10)];

    const nomes = component.contasMembro.map((conta) => conta.membro).sort();
    expect(nomes).toEqual(['Fernanda', 'João']);
  });

  it('ordena as compras da conta da mais antiga para a mais recente', () => {
    component.arrecadacoes = [venda('2', FERNANDA, 20), venda('1', FERNANDA, 30)];

    expect(component.contasMembro[0].vendas.map((v) => v.vendaId)).toEqual(['venda-1', 'venda-2']);
  });

  it('separa a conta do caixa em foco da dívida de outro caixa, e avisa', () => {
    // a lista olha só o caixa em foco: a compra de outro caixa vira aviso
    component.arrecadacoes = [
      venda('1', FERNANDA, 30),
      venda('2', FERNANDA, 20),
      venda('3', FERNANDA, 5, { caixa_id: CAIXA_ANTERIOR })
    ];

    expect(component.contasMembro.length).toBe(1);
    expect(component.contasMembro[0].total).toBe(50);
    expect(component.contasMembro[0].fiadoEmOutrosCaixas).toBe(5);
  });

  it('resume quem está devendo com uma linha por pessoa', () => {
    component.arrecadacoes = [venda('1', FERNANDA, 30), venda('2', FERNANDA, 20), venda('3', JOAO, 10)];

    expect(component.devedores.length).toBe(2);
    const fernanda = component.devedores.find((devedor) => devedor.nome === 'Fernanda');
    expect(fernanda?.total).toBe(50);
    expect(fernanda?.vendas).toBe(2);
    expect(fernanda?.dataVenda).toBe('2026-09-22T12:00:00.000Z');
  });

  it('conta uma venda de vários itens como uma venda só', () => {
    component.arrecadacoes = [
      item('venda-1', 'a', { status: 'pago', forma_pagamento: 'dinheiro', valor_total: 10 }),
      item('venda-1', 'b', { status: 'pago', forma_pagamento: 'dinheiro', valor_total: 20 })
    ];

    expect(component.vendasResumo.length).toBe(1);
    expect(component.vendasResumo[0].itens.length).toBe(2);
    expect(component.vendasResumo[0].total).toBe(30);
    expect(component.vendasPagas).toBe(1);
  });

  it('mostra as ações de uma venda que misturou mais de uma', () => {
    component.arrecadacoes = [
      item('venda-1', 'a', { categoria: 'bazar' }),
      item('venda-1', 'b', { categoria: 'feijoada' })
    ];

    expect(component.vendasResumo[0].categorias.sort()).toEqual(['bazar', 'feijoada']);
  });
});
