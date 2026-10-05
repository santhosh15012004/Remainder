import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomerService } from '../../services/customer.service';
import { ScheduleService } from '../../services/schedule.service';
import { ToastService } from '../../services/toast.service';
import { Customer } from '../../models/customer.model';
import { DeliverySchedule } from '../../models/schedule.model';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './customers.component.html',
  styleUrl: './customers.component.css'
})
export class CustomersComponent implements OnInit {
  private customerService = inject(CustomerService);
  private scheduleService = inject(ScheduleService);
  private toastService = inject(ToastService);

  customers: Customer[] = [];
  isLoading = true;
  searchTerm = '';

  // Add / Edit Modal
  isModalOpen = false;
  isEditMode = false;
  editingCustomerId: string | null = null;
  isSaving = false;

  customerForm = {
    name: '',
    phone: '',
    address: ''
  };

  // Customer Detail View Modal
  selectedCustomer: Customer | null = null;
  customerSchedules: DeliverySchedule[] = [];
  isLoadingSchedules = false;

  // Add Refill for this customer
  isAddRefillOpen = false;
  refillForm = {
    medicine_name: '',
    last_delivered_date: new Date().toISOString().substring(0, 10),
    interval_days: 30,
    notes: ''
  };

  // Delete Confirmation
  customerToDelete: Customer | null = null;

  ngOnInit() {
    this.loadCustomers();
  }

  loadCustomers() {
    this.isLoading = true;
    this.customerService.getCustomers(this.searchTerm).subscribe({
      next: (data) => {
        this.customers = data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error fetching customers:', err);
        this.toastService.error('Failed to load customers');
        this.isLoading = false;
      }
    });
  }

  onSearch() {
    this.loadCustomers();
  }

  openCreateModal() {
    this.isEditMode = false;
    this.editingCustomerId = null;
    this.customerForm = { name: '', phone: '', address: '' };
    this.isModalOpen = true;
  }

  openEditModal(customer: Customer) {
    this.isEditMode = true;
    this.editingCustomerId = customer.id;
    this.customerForm = {
      name: customer.name,
      phone: customer.phone || '',
      address: customer.address || ''
    };
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
  }

  saveCustomer() {
    if (!this.customerForm.name.trim()) {
      this.toastService.warning('Customer name is required');
      return;
    }

    this.isSaving = true;

    if (this.isEditMode && this.editingCustomerId) {
      this.customerService.updateCustomer(this.editingCustomerId, this.customerForm).subscribe({
        next: () => {
          this.toastService.success('Customer updated successfully!');
          this.closeModal();
          this.isSaving = false;
          this.loadCustomers();
        },
        error: (err) => {
          console.error('Error updating customer:', err);
          this.toastService.error('Failed to update customer');
          this.isSaving = false;
        }
      });
    } else {
      this.customerService.createCustomer(this.customerForm).subscribe({
        next: () => {
          this.toastService.success('Customer added successfully!');
          this.closeModal();
          this.isSaving = false;
          this.loadCustomers();
        },
        error: (err) => {
          console.error('Error creating customer:', err);
          this.toastService.error('Failed to create customer');
          this.isSaving = false;
        }
      });
    }
  }

  // Detail Modal
  viewCustomerDetails(customer: Customer) {
    this.selectedCustomer = customer;
    this.isLoadingSchedules = true;
    this.scheduleService.getSchedules({ customer_id: customer.id }).subscribe({
      next: (schedules) => {
        this.customerSchedules = schedules;
        this.isLoadingSchedules = false;
      },
      error: (err) => {
        console.error('Error loading patient prescriptions:', err);
        this.customerSchedules = [];
        this.isLoadingSchedules = false;
      }
    });
  }

  closeDetailsModal() {
    this.selectedCustomer = null;
    this.customerSchedules = [];
    this.isAddRefillOpen = false;
  }

  openAddRefill() {
    this.refillForm = {
      medicine_name: '',
      last_delivered_date: new Date().toISOString().substring(0, 10),
      interval_days: 30,
      notes: ''
    };
    this.isAddRefillOpen = true;
  }

  saveRefill() {
    if (!this.selectedCustomer) return;
    if (!this.refillForm.medicine_name.trim()) {
      this.toastService.warning('Medicine name is required');
      return;
    }

    this.scheduleService.createSchedule({
      customer_id: this.selectedCustomer.id,
      medicine_name: this.refillForm.medicine_name,
      last_delivered_date: this.refillForm.last_delivered_date,
      interval_days: this.refillForm.interval_days,
      notes: this.refillForm.notes
    }).subscribe({
      next: () => {
        this.toastService.success('Medicine refill added to patient schedule!');
        this.isAddRefillOpen = false;
        if (this.selectedCustomer) {
          this.viewCustomerDetails(this.selectedCustomer);
        }
      },
      error: (err) => {
        console.error('Error adding refill:', err);
        this.toastService.error('Failed to add refill');
      }
    });
  }

  // Delete Confirmation
  confirmDelete(customer: Customer) {
    this.customerToDelete = customer;
  }

  cancelDelete() {
    this.customerToDelete = null;
  }

  executeDelete() {
    if (!this.customerToDelete) return;
    const name = this.customerToDelete.name;
    this.customerService.deleteCustomer(this.customerToDelete.id).subscribe({
      next: () => {
        this.toastService.info(`Customer "${name}" deleted.`);
        this.customerToDelete = null;
        this.loadCustomers();
      },
      error: (err) => {
        console.error('Error deleting customer:', err);
        this.toastService.error('Failed to delete customer');
      }
    });
  }

  getInitials(name: string): string {
    if (!name) return 'C';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  getWhatsAppUrl(customer: Customer): string {
    const rawPhone = customer.phone ? customer.phone.replace(/[^0-9]/g, '') : '';
    const message = encodeURIComponent(
      `Hello ${customer.name},\nThis is a notification from the Pharmacy regarding your medicine deliveries and prescriptions.\nPlease let us know if you need any assistance!`
    );
    return `https://wa.me/${rawPhone}?text=${message}`;
  }
}
