export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  created_at?: string;
  updated_at?: string;
  schedules?: any[];
}
