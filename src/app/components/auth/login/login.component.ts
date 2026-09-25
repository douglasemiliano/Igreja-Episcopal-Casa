import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SupabaseService } from '../../../services/supabase.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',

  imports: [CommonModule, ReactiveFormsModule, FormsModule, MatIconModule, RouterModule],
})
export class LoginComponent {
  loginForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private supabase: SupabaseService,
    private toast: ToastService,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    });
  }

  async onSubmit() {
    if (this.loginForm.valid) {
      const { email, password } = this.loginForm.value;
      const { error } = await this.supabase.signIn(email, password);

      if (error) {
        this.toast.erro('Erro ao fazer login');
      } else {
        this.router.navigateByUrl("/home")
        this.toast.sucesso('Login realizado com sucesso');
      }
    }
  }

  async loginComGoogle() {
    try {
      const { data, error } = await this.supabase.signInWithGoogle();
      
      if (error) {
        console.error('Erro ao autenticar com o Google:', error.message);
        alert('Não foi possível fazer login com o Google.');
      }
      
      // Nota: Se der certo, o navegador será redirecionado automaticamente 
      // para a página do Google, então você não precisa colocar código aqui para sucesso.
    } catch (err) {
      console.error('Erro inesperado:', err);
    }
  }

}