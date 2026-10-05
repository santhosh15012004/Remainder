import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScheduleService } from '../../services/schedule.service';
import { CustomerService } from '../../services/customer.service';
import { ToastService } from '../../services/toast.service';
import { DeliverySchedule, ScheduleStatus } from '../../models/schedule.model';
import { Customer } from '../../models/customer.model';
import { PdfExportService } from '../../services/pdf-export.service';

@Component({
  selector: 'app-schedules',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './schedules.component.html',
  styleUrl: './schedules.component.css'
})
export class SchedulesComponent implements OnInit {
  private scheduleService = inject(ScheduleService);
  private customerService = inject(CustomerService);
  private toastService = inject(ToastService);
  private pdfExportService = inject(PdfExportService);

  schedules: DeliverySchedule[] = [];
  customers: Customer[] = [];
  isLoading = true;
  isExportingPdf = false;

  async downloadPdf() {
    if (this.isExportingPdf) return;
    this.isExportingPdf = true;
    try {
      await this.pdfExportService.exportSchedulesPdf();
    } finally {
      this.isExportingPdf = false;
    }
  }

  // Filters
  selectedStatus: string = 'ALL';
  searchTerm: string = '';

  // Add / Edit Schedule Modal
  isModalOpen = false;
  isEditMode = false;
  editingScheduleId: string | null = null;
  isSaving = false;

  scheduleForm = {
    customer_id: '',
    medicine_name: '',
    last_delivered_date: new Date().toISOString().substring(0, 10),
    interval_days: 30,
    next_schedule_date: '',
    notes: ''
  };

  // Deliver Action Modal
  isDeliverModalOpen = false;
  selectedSchedule: DeliverySchedule | null = null;
  deliverCycleDays = 30;
  isCompleteOnly = false;
  deliverNotes = '';
  isProcessingDelivery = false;

  // Delete Confirmation
  scheduleToDelete: DeliverySchedule | null = null;


  ngOnInit() {
    this.calculateNextDate();
    this.loadCustomers();
    this.loadSchedules();
  }

  loadCustomers() {
    this.customerService.getCustomers().subscribe({
      next: (data) => {
        this.customers = data;
        if (this.customers.length > 0 && !this.scheduleForm.customer_id) {
          this.scheduleForm.customer_id = this.customers[0].id;
        }
      },
      error: (err) => console.error('Error fetching customers:', err)
    });
  }

  loadSchedules() {
    this.isLoading = true;
    this.scheduleService.getSchedules({
      status: this.selectedStatus,
      search: this.searchTerm
    }).subscribe({
      next: (data) => {
        this.schedules = data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error fetching schedules:', err);
        this.toastService.error('Failed to load schedules');
        this.isLoading = false;
      }
    });
  }

  onFilterStatus(status: string) {
    this.selectedStatus = status;
    this.loadSchedules();
  }

  onSearch() {
    this.loadSchedules();
  }

  calculateNextDate() {
    if (!this.scheduleForm.last_delivered_date || !this.scheduleForm.interval_days) return;
    const baseDate = new Date(this.scheduleForm.last_delivered_date);
    baseDate.setDate(baseDate.getDate() + Number(this.scheduleForm.interval_days));
    this.scheduleForm.next_schedule_date = baseDate.toISOString().substring(0, 10);
  }

  calculateIntervalFromNextDate() {
    if (!this.scheduleForm.last_delivered_date || !this.scheduleForm.next_schedule_date) return;
    const last = new Date(this.scheduleForm.last_delivered_date);
    const next = new Date(this.scheduleForm.next_schedule_date);
    const diffMs = next.getTime() - last.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      this.scheduleForm.interval_days = diffDays;
    }
  }

  setInterval(days: number) {
    this.scheduleForm.interval_days = days;
    this.calculateNextDate();
  }

  setDeliverCycle(days: number) {
    this.deliverCycleDays = days;
  }

  getComputedDeliverDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + Number(this.deliverCycleDays || 30));
    return d.toISOString().substring(0, 10);
  }

  openCreateModal() {
    this.isEditMode = false;
    this.editingScheduleId = null;
    this.scheduleForm = {
      customer_id: this.customers.length > 0 ? this.customers[0].id : '',
      medicine_name: '',
      last_delivered_date: new Date().toISOString().substring(0, 10),
      interval_days: 30,
      next_schedule_date: '',
      notes: ''
    };
    this.calculateNextDate();
    this.isModalOpen = true;
  }

  openEditModal(schedule: DeliverySchedule) {
    this.isEditMode = true;
    this.editingScheduleId = schedule.id;
    this.scheduleForm = {
      customer_id: schedule.customer_id,
      medicine_name: schedule.medicine_name,
      last_delivered_date: schedule.last_delivered_date,
      interval_days: schedule.interval_days || 30,
      next_schedule_date: schedule.next_schedule_date,
      notes: schedule.notes || ''
    };
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
  }

  saveSchedule() {
    if (!this.scheduleForm.customer_id) {
      this.toastService.warning('Please select a customer');
      return;
    }
    if (!this.scheduleForm.medicine_name.trim()) {
      this.toastService.warning('Medicine name is required');
      return;
    }

    this.isSaving = true;

    if (this.isEditMode && this.editingScheduleId) {
      this.scheduleService.updateSchedule(this.editingScheduleId, {
        customer_id: this.scheduleForm.customer_id,
        medicine_name: this.scheduleForm.medicine_name,
        last_delivered_date: this.scheduleForm.last_delivered_date,
        next_schedule_date: this.scheduleForm.next_schedule_date,
        interval_days: Number(this.scheduleForm.interval_days) || 30,
        notes: this.scheduleForm.notes
      }).subscribe({
        next: () => {
          this.toastService.success('Delivery schedule updated successfully!');
          this.closeModal();
          this.isSaving = false;
          this.loadSchedules();
        },
        error: (err) => {
          console.error('Error updating schedule:', err);
          this.toastService.error('Failed to update schedule');
          this.isSaving = false;
        }
      });
    } else {
      this.scheduleService.createSchedule({
        customer_id: this.scheduleForm.customer_id,
        medicine_name: this.scheduleForm.medicine_name,
        last_delivered_date: this.scheduleForm.last_delivered_date,
        next_schedule_date: this.scheduleForm.next_schedule_date,
        interval_days: Number(this.scheduleForm.interval_days) || 30,
        notes: this.scheduleForm.notes
      }).subscribe({
        next: () => {
          this.toastService.success('Delivery schedule created successfully!');
          this.closeModal();
          this.isSaving = false;
          this.loadSchedules();
        },
        error: (err) => {
          console.error('Error creating schedule:', err);
          this.toastService.error('Failed to create schedule');
          this.isSaving = false;
        }
      });
    }
  }

  // Quick Deliver Dialog
  openDeliverModal(schedule: DeliverySchedule) {
    this.selectedSchedule = schedule;
    this.deliverCycleDays = schedule.interval_days || 30;
    this.isCompleteOnly = false;
    this.deliverNotes = '';
    this.isDeliverModalOpen = true;
  }

  closeDeliverModal() {
    this.isDeliverModalOpen = false;
    this.selectedSchedule = null;
  }

  confirmDelivery() {
    if (!this.selectedSchedule) return;

    this.isProcessingDelivery = true;
    this.scheduleService.markDelivered(this.selectedSchedule.id, {
      next_cycle_days: this.deliverCycleDays,
      complete_only: this.isCompleteOnly,
      notes: this.deliverNotes
    }).subscribe({
      next: () => {
        this.toastService.success(`Delivery recorded for ${this.selectedSchedule?.medicine_name}! Next refill scheduled.`);
        this.closeDeliverModal();
        this.isProcessingDelivery = false;
        this.loadSchedules();
      },
      error: (err) => {
        console.error('Error recording delivery:', err);
        this.toastService.error('Failed to record delivery');
        this.isProcessingDelivery = false;
      }
    });
  }

  // Delete
  confirmDelete(schedule: DeliverySchedule) {
    this.scheduleToDelete = schedule;
  }

  cancelDelete() {
    this.scheduleToDelete = null;
  }

  executeDelete() {
    if (!this.scheduleToDelete) return;
    const med = this.scheduleToDelete.medicine_name;
    this.scheduleService.deleteSchedule(this.scheduleToDelete.id).subscribe({
      next: () => {
        this.toastService.info(`Schedule for "${med}" deleted.`);
        this.scheduleToDelete = null;
        this.loadSchedules();
      },
      error: (err) => {
        console.error('Error deleting schedule:', err);
        this.toastService.error('Failed to delete schedule');
      }
    });
  }

  getWhatsAppUrl(schedule: DeliverySchedule): string {
    const rawPhone = schedule.customer_phone ? schedule.customer_phone.replace(/[^0-9]/g, '') : '';
    const message = encodeURIComponent(
      `Hello ${schedule.customer_name || 'Customer'},\nThis is a notification regarding your regular prescription: *${schedule.medicine_name}*.\nYour refill is scheduled for ${schedule.next_schedule_date}.\nPlease let us know if you require any adjustments.\nThank you, Pharmacy Team.`
    );
    return `https://wa.me/${rawPhone}?text=${message}`;
  }

  getRelativeDays(dateStr: string): string {
    if (!dateStr) return '';
    const target = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);

    const diffMs = target.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`;
    } else if (diffDays === 0) {
      return 'Due Today';
    } else if (diffDays === 1) {
      return 'Due Tomorrow';
    } else {
      return `Due in ${diffDays} days`;
    }
  }
}
