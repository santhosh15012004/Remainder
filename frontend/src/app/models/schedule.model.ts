export type ScheduleStatus = 'PENDING' | 'DUE_TODAY' | 'OVER_DUE' | 'COMPLETED';

export interface DeliverySchedule {
  id: string;
  customer_id: string;
  medicine_name: string;
  last_delivered_date: string;
  next_schedule_date: string;
  status: ScheduleStatus;
  interval_days?: number | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
}

export interface DashboardStats {
  total_customers: number;
  total_schedules: number;
  due_today: number;
  overdue: number;
  pending: number;
  completed: number;
  due_this_week: number;
  urgent_schedules: DeliverySchedule[];
}
