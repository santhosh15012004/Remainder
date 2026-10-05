import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Customer } from '../models/customer.model';
import { LocalDbService } from './local-db.service';

@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private localDb = inject(LocalDbService);

  getCustomers(search?: string): Observable<Customer[]> {
    return this.localDb.getCustomers(search);
  }

  getCustomer(id: string): Observable<Customer> {
    return this.localDb.getCustomer(id);
  }

  createCustomer(payload: { name: string; phone?: string; address?: string }): Observable<Customer> {
    return this.localDb.createCustomer(payload);
  }

  updateCustomer(id: string, payload: Partial<Customer>): Observable<Customer> {
    return this.localDb.updateCustomer(id, payload);
  }

  deleteCustomer(id: string): Observable<{ id: string }> {
    return this.localDb.deleteCustomer(id);
  }
}
