import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SupabaseService } from '../../../services/supabase.service';
import { MembroVinculoService } from '../../../services/membro-vinculo.service';
import { ToastService } from '../../../services/toast.service';
import { MembroVinculo } from '../../../model/membro.model';

/**
 * Quanto tempo a tela espera o banco antes de se declarar indisponível.
 * Generoso de propósito: em 3G ruim a chamada passa de 8s, e um timeout
 * curto transformaria lentidão em erro.
 */
const TEMPO_LIMITE_CARREGAMENTO_MS = 15_000;

@Component({
  selector: 'app-completar-cadastro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './completar-cadastro.component.html',
  styleUrl: './completar-cadastro.component.scss',
})
export class CompletarCadastroComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SupabaseService);
  private readonly vinculo = inject(MembroVinculoService);
  private readonly router = inject(Router);
  private readonly rota = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  readonly carregando = signal<boolean>(true);
  readonly enviando = signal<boolean>(false);

  private tempoEsgotado: ReturnType<typeof setTimeout> | null = null;

  /**
   * `ambiguo` e `sem_email` não têm formulário. São os dois casos em que o
   * banco não criou pré-cadastro porque não havia com quem casar a conta —
   * a tela explica e manda falar com a secretaria em vez de oferecer campos
   * que não poderiam ser gravados.
   */
  readonly bloqueado = signal<'ambiguo' | 'sem_email' | 'erro' | null>(null);

  readonly membro = signal<MembroVinculo | null>(null);
  readonly emailConta = signal<string>('');
  readonly nomeConta = signal<string>('');

  /**
   * "Abrir cadastro do zero" ou "conferir o que já existe"? Só a tela precisa
   * disso, para trocar o texto e o rótulo do botão.
   */
  readonly ehPreCadastro = this.vinculo.ehPreCadastro;

  readonly form = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(3)]],
    telefone: [''],
    dataNascimento: [''],
    sexo: [''],
    endereco: [''],
    funcao: [''],
  });

  async ngOnInit(): Promise<void> {
    this.bloqueado.set(null);
    this.armarTimeout();
    try {
      await this.montar();
    } finally {
      this.disarmarTimeout();
    }
  }

  private async montar(): Promise<void> {
    const resposta = await this.vinculo.carregar();
    const conta = await this.supabase.getUser();

    this.emailConta.set(conta?.email ?? '');
    this.nomeConta.set((conta?.user_metadata?.['full_name'] as string) || conta?.user_metadata?.['name'] as string || '');

    if (resposta.status === 'ambiguo' || resposta.status === 'sem_email') {
      this.bloqueado.set(resposta.status);
      this.carregando.set(false);
      return;
    }

    if (resposta.status === 'erro') {
      this.bloqueado.set('erro');
      this.carregando.set(false);
      return;
    }

    // Já tinha completo E já tinha passado por aqui: se a pessoa entrou pela
    // URL, devolve para casa. Só `completo` não basta, porque a tela existe
    // justamente para o registro que já estava pronto e nunca foi conferido.
    if (resposta.status === 'vinculado' && resposta.completo && resposta.verificado) {
      this.vaiParaDestino();
      return;
    }

    // O que o login já preencheu aparece pronto para conferir, tanto no
    // pré-cadastro quanto no registro antigo que acabou de ser vinculado.
    const atual = await this.vinculo.meuMembro();
    this.membro.set(atual);
    this.form.patchValue({
      nome: atual.nome || this.nomeConta() || '',
      telefone: atual.telefone ?? '',
      dataNascimento: atual.data_nascimento ?? '',
      sexo: atual.sexo ?? '',
      endereco: atual.endereco ?? '',
      funcao: atual.funcao ?? '',
    });

    this.carregando.set(false);
  }

  /**
   * rede de segurança contra tela morta.
   *
   * `carregar()` e `meuMembro()` são chamadas de rede, e uma que não resolve
   * deixa o "Verificando seu cadastro" girando para sempre, sem botão, sem
   * erro e sem forma de sair. A pessoa fica presa numa tela que não termina,
   * e o sintoma é indistinguível de "o app travou".
   *
   * Depois deste tempo a tela vira o estado de erro, que tem saída. Não é
   * perfeito — pode ser a rede lenta — mas é infinitamente melhor do que não
   * ter volta.
   */
  private armarTimeout(): void {
    this.disarmarTimeout();
    this.tempoEsgotado = setTimeout(() => {
      if (this.carregando()) {
        this.carregando.set(false);
        this.bloqueado.set('erro');
      }
    }, TEMPO_LIMITE_CARREGAMENTO_MS);
  }

  private disarmarTimeout(): void {
    if (this.tempoEsgotado !== null) {
      clearTimeout(this.tempoEsgotado);
      this.tempoEsgotado = null;
    }
  }

  ngOnDestroy(): void {
    this.disarmarTimeout();
  }

  async enviar(): Promise<void> {
    if (this.form.invalid || this.enviando()) {
      this.form.markAllAsTouched();
      return;
    }

    this.enviando.set(true);
    try {
      const bruto = this.form.getRawValue();
      const resultado = await this.vinculo.completar({
        nome: bruto.nome,
        telefone: bruto.telefone,
        // '' numa coluna date é erro no Postgres; a função espera null.
        dataNascimento: bruto.dataNascimento || null,
        sexo: bruto.sexo,
        endereco: bruto.endereco,
        funcao: bruto.funcao,
      });

      if (resultado.status !== 'ok') {
        this.toast.erro(resultado.mensagem ?? 'Não foi possível salvar.');
        return;
      }

      this.toast.sucesso(
        this.vinculo.ehPreCadastro()
          ? 'Cadastro concluído. Bem-vindo à igreja!'
          : 'Dados atualizados. Obrigado!'
      );
      this.vaiParaDestino();
    } finally {
      this.enviando.set(false);
    }
  }

  /**
   * Sai da tela sem preencher.
   *
   * Precisa existir: a tela é obrigatória no primeiro acesso, e sem uma saída
   * quem não tem nenhum dado novo a informar fica preso nela — inclusive no
   * caso mais comum, que é o membro antigo cujo cadastro já estava correto.
   * O banco carimba a mesma marca de qualquer forma, então pular não faz a
   * tela voltar no próximo login; dá para conferir depois pelo perfil.
   */
  async pular(): Promise<void> {
    if (this.enviando()) return;

    this.enviando.set(true);
    try {
      const resultado = await this.vinculo.pularAtualizacao();

      if (resultado.status !== 'ok') {
        this.toast.erro('Não foi possível continuar agora. Tente de novo.');
        return;
      }

      this.toast.sucesso('Você pode atualizar seus dados depois pelo perfil.');
      this.vaiParaDestino();
    } finally {
      this.enviando.set(false);
    }
  }

  /** Recarrega o vínculo depois de um erro passageiro. */
  async recarregar(): Promise<void> {
    this.bloqueado.set(null);
    this.carregando.set(true);
    this.vinculo.limpar();
    await this.ngOnInit();
  }

  /**
   * Sai da tela mesmo sem ter resolvido o vínculo.
   *
   * Existe porque o resto do app já decidiu essa questão: o AuthGuard, quando
   * `entrar_no_membro` não responde, libera a navegação em vez de trancar todo
   * o sistema atrás de uma tela que provavelmente também falharia. Se o
   * primeiro decide não bloquear, esta tela não pode ser mais restritiva que
   * ele — senão a pessoa fica presa exatamente no caso em que algo está
   * quebrado, sem nenhum botão para sair.
   *
   * Não é caminho para pular cadastro de verdade: quem quizer fazer isso de
   * fato tem o botão "Agora não", que grava o carimbo. Este é só o botão de
   * emergência de quando o banco não responde.
   */
  entrarAssim(): void {
    this.vaiParaDestino();
  }

  /**
   * Volta para onde a pessoa tentava ir antes de ser desviada. O query param
   * vem da URL, então precisa ser validado: sem isto, `?origem=https://site
   * malicioso` viraria um redirecionamento aberto.
   */
  private vaiParaDestino(): void {
    const origem = this.rota.snapshot.queryParamMap.get('origem');
    const interno = origem && origem.startsWith('/') && !origem.startsWith('//') ? origem : '/home';
    this.router.navigateByUrl(interno);
  }

  async sair(): Promise<void> {
    await this.supabase.signOut();
    this.vinculo.limpar();
    this.router.navigateByUrl('/login');
  }
}
