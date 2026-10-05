import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ScheduleService } from '../../services/schedule.service';
import { CustomerService } from '../../services/customer.service';
import { ToastService } from '../../services/toast.service';
import { NotificationService } from '../../services/notification.service';
import { DashboardStats, DeliverySchedule } from '../../models/schedule.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private scheduleService = inject(ScheduleService);
  private customerService = inject(CustomerService);
  private toastService = inject(ToastService);

  stats: DashboardStats = {
    total_customers: 0,
    total_schedules: 0,
    due_today: 0,
    overdue: 0,
    pending: 0,
    completed: 0,
    due_this_week: 0,
    urgent_schedules: []
  };

  isLoading = true;
  todayDate = new Date();

  // Delivery modal state
  selectedSchedule: DeliverySchedule | null = null;
  isDeliverModalOpen = false;
  deliverCycleDays = 30;
  isCompleteOnly = false;
  deliverNotes = '';
  isProcessingDelivery = false;

  // New Customer modal state
  isCustomerModalOpen = false;
  newCustomer = { name: '', phone: '', address: '' };
  isSubmittingCustomer = false;

  private notificationService = inject(NotificationService);

  ngOnInit() {
    this.loadDashboardData();
  }

  loadDashboardData() {
    this.isLoading = true;
    this.scheduleService.getDashboardStats().subscribe({
      next: (data) => {
        this.stats = data;
        this.isLoading = false;
        if (data.urgent_schedules && data.urgent_schedules.length > 0) {
          this.notificationService.syncScheduleAlarms(data.urgent_schedules);
        }
      },
      error: (err) => {
        console.error('Error fetching dashboard stats:', err);
        this.toastService.error('Failed to load dashboard metrics');
        this.isLoading = false;
      }
    });
  }

  // Alarm & Notification Modal State
  isAlarmSettingsOpen = false;
  alarmPrefs = this.notificationService.getPrefs();
  registeredAlarmsCount = 0;

  async openAlarmSettings() {
    this.alarmPrefs = this.notificationService.getPrefs();
    const alarms = await this.notificationService.getRegisteredAlarms();
    this.registeredAlarmsCount = alarms.length;
    this.isAlarmSettingsOpen = true;
  }

  closeAlarmSettings() {
    this.isAlarmSettingsOpen = false;
  }

  saveAlarmSettings() {
    this.notificationService.savePrefs(this.alarmPrefs);
    this.scheduleService.getSchedules().subscribe();
    this.toastService.success('Reminder settings saved! Alarms updated in Android.');
    this.closeAlarmSettings();
  }

  openDeliverModal(schedule: DeliverySchedule) {
    this.selectedSchedule = schedule;
    this.deliverCycleDays = schedule.interval_days || 30;
    this.isCompleteOnly = false;
    this.deliverNotes = '';
    this.isDeliverModalOpen = true;
  }

  setDeliverCycle(days: number) {
    this.deliverCycleDays = days;
  }

  getComputedDeliverDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + Number(this.deliverCycleDays || 30));
    return d.toISOString().substring(0, 10);
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
        this.toastService.success(`Delivery recorded for ${this.selectedSchedule?.medicine_name}!`);
        this.closeDeliverModal();
        this.isProcessingDelivery = false;
        this.loadDashboardData();
      },
      error: (err) => {
        console.error('Error recording delivery:', err);
        this.toastService.error('Failed to update delivery');
        this.isProcessingDelivery = false;
      }
    });
  }

  openCustomerModal() {
    this.newCustomer = { name: '', phone: '', address: '' };
    this.isCustomerModalOpen = true;
  }

  closeCustomerModal() {
    this.isCustomerModalOpen = false;
  }

  submitCustomer() {
    if (!this.newCustomer.name.trim()) {
      this.toastService.warning('Customer name is required');
      return;
    }

    this.isSubmittingCustomer = true;
    this.customerService.createCustomer(this.newCustomer).subscribe({
      next: (customer) => {
        this.toastService.success(`Customer "${customer.name}" created successfully!`);
        this.closeCustomerModal();
        this.isSubmittingCustomer = false;
        this.loadDashboardData();
      },
      error: (err) => {
        console.error('Error creating customer:', err);
        this.toastService.error('Failed to create customer');
        this.isSubmittingCustomer = false;
      }
    });
  }

  getWhatsAppUrl(schedule: DeliverySchedule): string {
    const rawPhone = schedule.customer_phone ? schedule.customer_phone.replace(/[^0-9]/g, '') : '';
    const message = encodeURIComponent(
      `Hello ${schedule.customer_name || 'Customer'},\nThis is a friendly reminder from the Pharmacy regarding your medicine refill for: *${schedule.medicine_name}*.\nPlease let us know if you need your delivery today!\nThank you.`
    );
    return `https://wa.me/${rawPhone}?text=${message}`;
  }
}
