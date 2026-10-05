import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { DeliverySchedule, DashboardStats } from '../models/schedule.model';
import { LocalDbService } from './local-db.service';
import { NotificationService } from './notification.service';

@Injectable({
  providedIn: 'root'
})
export class ScheduleService {
  private localDb = inject(LocalDbService);
  private notificationService = inject(NotificationService);

  getDashboardStats(): Observable<DashboardStats> {
    return this.localDb.getDashboardStats().pipe(
      tap(() => {
        // Automatically sync advance delivery alarms in the background
        this.rescheduleAlarms();
      })
    );
  }

  getSchedules(filters?: { status?: string; customer_id?: string; search?: string }): Observable<DeliverySchedule[]> {
    return this.localDb.getSchedules(filters).pipe(
      tap((schedules) => {
        if (!filters || (!filters.status && !filters.search && !filters.customer_id)) {
          this.notificationService.syncScheduleAlarms(schedules);
        }
      })
    );
  }

  getSchedule(id: string): Observable<DeliverySchedule> {
    return this.localDb.getSchedule(id);
  }

  createSchedule(payload: {
    customer_id: string;
    medicine_name: string;
    last_delivered_date?: string;
    next_schedule_date?: string;
    interval_days?: number;
    notes?: string;
  }): Observable<DeliverySchedule> {
    return this.localDb.createSchedule(payload).pipe(
      tap(() => this.rescheduleAlarms())
    );
  }

  updateSchedule(id: string, payload: Partial<DeliverySchedule>): Observable<DeliverySchedule> {
    return this.localDb.updateSchedule(id, payload).pipe(
      tap(() => this.rescheduleAlarms())
    );
  }

  markDelivered(
    id: string,
    payload: { next_cycle_days?: number; complete_only?: boolean; notes?: string } = { next_cycle_days: 30 }
  ): Observable<DeliverySchedule> {
    return this.localDb.markDelivered(id, payload).pipe(
      tap(() => this.rescheduleAlarms())
    );
  }

  deleteSchedule(id: string): Observable<{ id: string }> {
    return this.localDb.deleteSchedule(id).pipe(
      tap(() => this.rescheduleAlarms())
    );
  }

  private rescheduleAlarms() {
    this.localDb.getSchedules().subscribe({
      next: (allSchedules) => {
        this.notificationService.syncScheduleAlarms(allSchedules);
      },
      error: () => {}
    });
  }
}
