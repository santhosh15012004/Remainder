import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  private authService = inject(AuthService);
  private fb = inject(FormBuilder);
  private router = inject(Router);

  loginform = this.fb.group({
    email: ['admin@pharmacy.com', [Validators.required, Validators.email]],
    password: ['AdminPass123!', [Validators.required]]
  });

  message = '';
  isError = false;
  isLoading = false;

  ngOnInit() {
    // If already logged in, navigate straight to dashboard
    if (this.authService.getToken()) {
      this.router.navigate(['/dashboard']);
    }
  }

  async login() {
    if (this.loginform.invalid) {
      this.loginform.markAllAsTouched();
      this.message = 'Please enter a valid email and password.';
      this.isError = true;
      return;
    }

    const { email, password } = this.loginform.value;
    if (!email || !password) return;

    this.isLoading = true;
    this.message = '';
    this.isError = false;

    try {
      await this.authService.login(email, password);
      this.message = 'Login successful!';
      this.router.navigate(['/dashboard']);
    } catch (error: any) {
      console.warn('Firebase login attempt:', error?.message);
      // If Firebase Auth project is in dev mode or unconfigured account, fallback to demo login seamlessly:
      this.message = 'Invalid credentials or Firebase dev mode. You can use Quick Demo Access below.';
      this.isError = true;
    } finally {
      this.isLoading = false;
    }
  }

  loginAsDemo() {
    this.authService.demoLogin();
  }
}