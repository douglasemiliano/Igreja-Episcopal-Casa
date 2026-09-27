import { Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { GuestGuard } from './guards/guest.guard';
import { PermissaoGuard } from './guards/permissao.guard';
import { HomeComponent } from './components/home/home.component';

/**
 * Rotas guardadas por capacidade, não por lista de papéis.
 *
 * `data: { chave: '...' }` aponta para uma linha de `public.permissoes`.
 * Quem pode abrir cada tela é decidido na tela /permissoes, e não aqui.
 *
 * A lista de papéis que o app inteiro reconhece — e que o gerenciador de
 * usuários oferece — está em `SupabaseService.rolesDisponiveis`.
 */
export const routes: Routes = [
    { path: 'home', loadComponent: () => import('./components/feed/feed.component').then(c => c.FeedComponent), data: { animation: 'home' }, canActivate: [AuthGuard] },
    { path: 'central', component: HomeComponent, canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'ver_central' } },
    { path: 'perfil', loadComponent: () => import('./components/perfil/perfil.component').then(c => c.PerfilComponent), canActivate: [AuthGuard] },
    { path: 'lecionario', loadComponent: () => import('./components/lecionario/view-lecionario/view-lecionario.component').then(c => c.ViewLecionarioComponent), canActivate: [AuthGuard] },
    { path: 'lecionario/listar', loadComponent: () => import('./components/lecionario/listar-lecionario/listar-lecionario.component').then(c => c.ListarLecionarioComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'gerenciar_lecionario' } },
    { path: '', redirectTo: '/home', pathMatch: 'full' },
    { path: 'mural', redirectTo: '/home', pathMatch: 'full' },
    { path: "login", loadComponent: () => import('./components/auth/login/login.component').then(c => c.LoginComponent), canActivate: [GuestGuard] },
    { path: 'lecionario/cadastro', loadComponent: () => import('./components/lecionario/cadastro-lecionario/cadastro-lecionario.component').then(c => c.CadastroLecionarioComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'gerenciar_lecionario' } },
    { path: 'certificado', loadComponent: ()=> import('./components/certificado/certificado.component').then(c => c.CertificadoComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'emitir_certificado' }},
    { path: 'certificado/confirmacao', loadComponent: () => import('./components/certificado/certificado-confirmacao/certificado-confirmacao.component').then(c => c.CertificadoConfirmacaoComponent) },
    { path: 'certificado/batismo', loadComponent: () => import('./components/certificado/certificado-batismo/certificado-batismo.component').then(c => c.CertificadoBatismoComponent) },
    { path: 'membros/cadastrar', loadComponent: () => import('./components/membros/cadastrar-membro/cadastrar-membro.component').then(c => c.CadastrarMembroComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'cadastrar_membros' } },
    { path: 'membros', loadComponent: () => import('./components/membros/listar-membro/listar-membro.component').then(c => c.ListarMembrosComponent), canActivate: [AuthGuard] },
    { path: 'membros/:id', loadComponent: () => import('./components/membros/detalhe-membro/detalhe-membro.component').then(c => c.DetalheMembroComponent), canActivate: [AuthGuard] },
    /*
     * A agenda fica aberta a todos autenticados: o SELECT da tabela é
     * liberado, e o que é restrito são os botões, guardado por
     * `publicar_evento` / `editar_evento` / `excluir_evento`.
     */
    { path: 'agenda', loadComponent: () => import('./components/agenda/agenda.component').then(c => c.AgendaComponent), canActivate: [AuthGuard] },
    { path: 'acoes', loadComponent: () => import('./components/arrecadacoes/arrecadacoes.component').then(c => c.ArrecadacoesComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'operar_arrecadacoes' } },
    { path: 'relatorios-caixas', loadComponent: () => import('./components/relatorios-caixa/relatorios-caixa.component').then(c => c.RelatoriosCaixaComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'ver_relatorios_caixa' } },
    { path: 'dashboard', loadComponent: () => import('./components/dashboard/dashboard.component').then(c => c.DashboardComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'ver_dashboard' } },
    { path: 'usuarios', loadComponent: () => import('./components/usuarios/gerenciar-usuarios/gerenciar-usuarios.component').then(c => c.GerenciarUsuariosComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'gerenciar_usuarios' } },
    { path: 'permissoes', loadComponent: () => import('./components/permissoes/gerenciar-permissoes/gerenciar-permissoes.component').then(c => c.GerenciarPermissoesComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'gerenciar_permissoes' } },
    { path: 'livro', loadComponent: () => import('./components/livro-registro/livro-registro.component').then(c => c.LivroRegistroComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'ver_livro_registro' }},
    { path: 'livro/batismo', loadComponent: () => import('./components/livro-registro/lista-batismo/lista-batismo.component').then(c => c.ListaBatismoComponent)},
    { path: 'livro/batismo/cadastro', loadComponent: () => import('./components/livro-registro/registro-batismo/registro-batismo.component').then(c => c.RegistroBatismoComponent), canActivate: [AuthGuard, PermissaoGuard], data: { chave: 'registrar_batismo' }},

];

