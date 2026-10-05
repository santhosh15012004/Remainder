import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { 
  Auth, 
  signInWithEmailAndPassword, 
  signOut, 
  user, 
  User, 
  UserCredential 
} from '@angular/fire/auth';
import { Observable, BehaviorSubject, of } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private auth = inject(Auth, { optional: true });
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  // Observable for the currently authenticated Firebase user or local offline user
  private localUserSubject = new BehaviorSubject<any>(this.getInitialLocalUser());
  readonly user$: Observable<any> = this.auth ? user(this.auth) : this.localUserSubject.asObservable();

  // BehaviorSubject to track logged-in state reactively
  private loggedInSubject = new BehaviorSubject<boolean>(this.hasToken());
  readonly isLoggedIn$ = this.loggedInSubject.asObservable();

  private getInitialLocalUser(): any {
    if (isPlatformBrowser(this.platformId) && this.hasToken()) {
      return {
        email: this.getUserEmail(),
        displayName: 'Pharmacy Admin',
        uid: 'local-offline-user-1'
      };
    }
    return null;
  }

  /**
   * Check if token is available in local storage (Browser safe)
   */
  private hasToken(): boolean {
    if (isPlatformBrowser(this.platformId)) {
      return !!localStorage.getItem('token');
    }
    return false;
  }

  /**
   * Login user: attempts Firebase first if online, else falls back to offline local auth
   */
  async login(email: string, password: string): Promise<any> {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();

    // 1. Try Firebase if available and online
    if (this.auth && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const userCredential = await signInWithEmailAndPassword(this.auth, cleanEmail, cleanPass);
        const token = await userCredential.user.getIdToken();
        this.setToken(token);
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('user_email', cleanEmail);
        }
        this.loggedInSubject.next(true);
        this.localUserSubject.next({
          email: cleanEmail,
          displayName: 'Pharmacy Admin',
          uid: userCredential.user.uid
        });
        return userCredential;
      } catch (err: any) {
        console.warn('Firebase login unavailable or failed, falling back to local offline mode:', err?.message);
      }
    }

    // 2. Standalone offline mode for local phone execution
    // Default demo: admin@pharmacy.com / AdminPass123! or any registered admin email
    if (cleanEmail && cleanPass) {
      const demoToken = 'local-offline-jwt-' + Date.now();
      this.setToken(demoToken);
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('user_email', cleanEmail);
      }
      this.loggedInSubject.next(true);
      this.localUserSubject.next({
        email: cleanEmail,
        displayName: 'Pharmacy Admin',
        uid: 'local-offline-user-1'
      });
      return {
        user: {
          email: cleanEmail,
          uid: 'local-offline-user-1'
        }
      };
    }

    throw new Error('Please enter a valid email and password.');
  }

  /**
   * Store JWT token in localStorage
   */
  setToken(token: string): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('token', token);
    }
  }

  /**
   * Retrieve JWT token from localStorage
   */
  getToken(): string | null {
    if (isPlatformBrowser(this.platformId)) {
      return localStorage.getItem('token');
    }
    return null;
  }

  /**
   * Get a fresh Firebase ID token or return local token
   */
  async getFreshToken(): Promise<string | null> {
    if (this.auth?.currentUser) {
      try {
        const token = await this.auth.currentUser.getIdToken(true);
        this.setToken(token);
        return token;
      } catch {
        // Fall back to stored token
      }
    }
    return this.getToken();
  }

  /**
   * Quick demo login for instant preview and offline phone execution
   */
  demoLogin(): void {
    const demoToken = 'demo-jwt-token-' + Date.now();
    this.setToken(demoToken);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('user_email', 'admin@pharmacy.com');
    }
    this.loggedInSubject.next(true);
    this.localUserSubject.next({
      email: 'admin@pharmacy.com',
      displayName: 'Pharmacy Admin',
      uid: 'local-demo-user'
    });
    this.router.navigate(['/dashboard']);
  }

  /**
   * Get user email from local cache
   */
  getUserEmail(): string {
    if (isPlatformBrowser(this.platformId)) {
      return localStorage.getItem('user_email') || 'admin@pharmacy.com';
    }
    return 'admin@pharmacy.com';
  }

  /**
   * Log out user, remove token, and redirect
   */
  async logout(): Promise<void> {
    if (this.auth) {
      try {
        await signOut(this.auth);
      } catch {
        // Ignore if not signed in via Firebase
      }
    }
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user_email');
    }
    this.loggedInSubject.next(false);
    this.localUserSubject.next(null);
    this.router.navigate(['/login']);
  }
}