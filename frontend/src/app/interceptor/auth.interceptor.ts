import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>, 
  next: HttpHandlerFn
) => {
  const authService = inject(AuthService);
  const token = authService.getToken();

  // Clone request and attach Authorization header if token is present
  let authReq = req;
  if (token) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  // Pass cloned request to the next handler and intercept errors
  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // If backend returns 401 Unauthorized, automatically log out
      if (error.status === 401) {
        console.warn('Session expired or unauthorized. Logging out...');
        authService.logout();
      }
      return throwError(() => error);
    })
  );
};