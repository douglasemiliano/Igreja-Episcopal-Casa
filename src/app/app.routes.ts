import { Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { GuestGuard } from './guards/guest.guard';
import { RoleGuard } from './guards/role.guard';
import { HomeComponent } from './components/home/home.component';
import { LoginComponent } from './components/auth/login/login.component';

export const routes: Routes = [
    { path: 'home', component: HomeComponent, data: { animation: 'home' }, canActivate: [AuthGuard] },
    { path: 'perfil', loadComponent: () => import('./components/perfil/perfil.component').then(c => c.PerfilComponent), canActivate: [AuthGuard] },
    { path: 'lecionario', loadComponent: () => import('./components/lecionario/view-lecionario/view-lecionario.component').then(c => c.ViewLecionarioComponent), canActivate: [AuthGuard] }, 
    { path: 'lecionario/listar', loadComponent: () => import('./components/lecionario/listar-lecionario/listar-lecionario.component').then(c => c.ListarLecionarioComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'secretaria', 'pastor'] } },
    { path: '', redirectTo: '/mural', pathMatch: 'full' },
    { path: "login", loadComponent: () => import('./components/auth/login/login.component').then(c => c.LoginComponent), canActivate: [GuestGuard] },
    { path: 'lecionario/cadastro', loadComponent: () => import('./components/lecionario/cadastro-lecionario/cadastro-lecionario.component').then(c => c.CadastroLecionarioComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'secretaria', 'pastor'] } },
    { path: 'certificado', loadComponent: ()=> import('./components/certificado/certificado.component').then(c => c.CertificadoComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'secretaria', 'pastor'] }},
    { path: 'certificado/confirmacao', loadComponent: () => import('./components/certificado/certificado-confirmacao/certificado-confirmacao.component').then(c => c.CertificadoConfirmacaoComponent) },
    { path: 'certificado/batismo', loadComponent: () => import('./components/certificado/certificado-batismo/certificado-batismo.component').then(c => c.CertificadoBatismoComponent) },
    { path: 'membros/cadastrar', loadComponent: () => import('./components/membros/cadastrar-membro/cadastrar-membro.component').then(c => c.CadastrarMembroComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'secretaria', 'pastor'] } },
    { path: 'membros', loadComponent: () => import('./components/membros/listar-membro/listar-membro.component').then(c => c.ListarMembrosComponent), canActivate: [AuthGuard] },
    { path: 'membros/:id', loadComponent: () => import('./components/membros/detalhe-membro/detalhe-membro.component').then(c => c.DetalheMembroComponent), canActivate: [AuthGuard] },
    { path: 'agenda', loadComponent: () => import('./components/agenda/agenda.component').then(c => c.AgendaComponent), canActivate: [AuthGuard] },
    { path: 'mural', loadComponent: () => import('./components/feed/feed.component').then(c => c.FeedComponent), canActivate: [AuthGuard] },
    { path: 'acoes', loadComponent: () => import('./components/arrecadacoes/arrecadacoes.component').then(c => c.ArrecadacoesComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'caixa', 'tesouraria', 'pastor'] } },
    { path: 'relatorios-caixas', loadComponent: () => import('./components/relatorios-caixa/relatorios-caixa.component').then(c => c.RelatoriosCaixaComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'secretaria', 'caixa', 'tesouraria', 'pastor'] } },
    { path: 'dashboard', loadComponent: () => import('./components/dashboard/dashboard.component').then(c => c.DashboardComponent), canActivate: [AuthGuard] },
    { path: 'usuarios', loadComponent: () => import('./components/usuarios/gerenciar-usuarios/gerenciar-usuarios.component').then(c => c.GerenciarUsuariosComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'pastor'] } },
    { path: 'livro', loadComponent: () => import('./components/livro-registro/livro-registro.component').then(c => c.LivroRegistroComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'secretaria', 'pastor'] }},
    { path: 'livro/batismo', loadComponent: () => import('./components/livro-registro/lista-batismo/lista-batismo.component').then(c => c.ListaBatismoComponent)},
    { path: 'livro/batismo/cadastro', loadComponent: () => import('./components/livro-registro/registro-batismo/registro-batismo.component').then(c => c.RegistroBatismoComponent), canActivate: [AuthGuard, RoleGuard], data: { roles: ['administrador', 'secretaria', 'pastor'] }},
    
];
