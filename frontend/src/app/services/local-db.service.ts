import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, from, of } from 'rxjs';
import { Customer } from '../models/customer.model';
import { DeliverySchedule, DashboardStats, ScheduleStatus } from '../models/schedule.model';

const DB_NAME = 'remainder_local_db_v2';
const DB_VERSION = 1;
const STORE_CUSTOMERS = 'customers';
const STORE_SCHEDULES = 'schedules';
const LOCAL_STORAGE_CUSTOMERS_KEY = 'remainder_customers_v2';
const LOCAL_STORAGE_SCHEDULES_KEY = 'remainder_schedules_v2';

@Injectable({
  providedIn: 'root'
})
export class LocalDbService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor() {
    if (this.isBrowser) {
      try {
        // Clear old legacy demo seed databases and keys so user starts with a clean slate
        localStorage.removeItem('remainder_customers_v1');
        localStorage.removeItem('remainder_schedules_v1');
        if (typeof window !== 'undefined' && window.indexedDB && window.indexedDB.deleteDatabase) {
          window.indexedDB.deleteDatabase('remainder_local_db');
        }
      } catch {
        // Ignore errors in environments where deleteDatabase is restricted
      }
      this.initDb();
    }
  }

  private initDb(): Promise<IDBDatabase | null> {
    if (!this.isBrowser || typeof window === 'undefined' || !window.indexedDB) {
      return Promise.resolve(null);
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_CUSTOMERS)) {
            db.createObjectStore(STORE_CUSTOMERS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_SCHEDULES)) {
            const schedStore = db.createObjectStore(STORE_SCHEDULES, { keyPath: 'id' });
            schedStore.createIndex('customer_id', 'customer_id', { unique: false });
            schedStore.createIndex('status', 'status', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          resolve(db);
        };

        request.onerror = (err) => {
          console.warn('IndexedDB open error, falling back to LocalStorage:', err);
          resolve(null);
        };
      } catch (err) {
        console.warn('IndexedDB not supported or blocked, using LocalStorage:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  // ==========================================
  // STATUS RECALCULATION ENGINE (AUTO-SYNC)
  // ==========================================
  private computeStatus(schedule: DeliverySchedule): ScheduleStatus {
    if (schedule.status === 'COMPLETED') {
      return 'COMPLETED';
    }
    const todayStr = new Date().toISOString().split('T')[0];
    const schedDate = schedule.next_schedule_date ? schedule.next_schedule_date.substring(0, 10) : '';

    if (!schedDate) return 'PENDING';
    if (schedDate < todayStr) return 'OVER_DUE';
    if (schedDate === todayStr) return 'DUE_TODAY';
    return 'PENDING';
  }

  private syncStatuses(schedules: DeliverySchedule[], customers: Customer[]): DeliverySchedule[] {
    const custMap = new Map<string, Customer>();
    customers.forEach(c => custMap.set(c.id, c));

    return schedules.map(s => {
      const updatedStatus = this.computeStatus(s);
      const cust = custMap.get(s.customer_id);
      return {
        ...s,
        status: updatedStatus,
        customer_name: cust ? cust.name : (s.customer_name || 'Unknown Patient'),
        customer_phone: cust ? cust.phone : s.customer_phone,
        customer_address: cust ? cust.address : s.customer_address
      };
    });
  }

  // ==========================================
  // LOW-LEVEL DB OPERATIONS
  // ==========================================
  private async getAllRecords<T>(storeName: string, lsKey: string): Promise<T[]> {
    if (!this.isBrowser) return [];

    const db = await this.initDb();
    if (db) {
      return new Promise<T[]>((resolve) => {
        try {
          const tx = db.transaction([storeName], 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => {
            const fallback = this.getFromLocalStorage<T>(lsKey);
            resolve(fallback);
          };
        } catch {
          const fallback = this.getFromLocalStorage<T>(lsKey);
          resolve(fallback);
        }
      });
    }

    return this.getFromLocalStorage<T>(lsKey);
  }

  private async saveRecord<T extends { id: string }>(storeName: string, lsKey: string, item: T): Promise<T> {
    if (!this.isBrowser) return item;

    const db = await this.initDb();
    if (db) {
      return new Promise<T>((resolve, reject) => {
        try {
          const tx = db.transaction([storeName], 'readwrite');
          const store = tx.objectStore(storeName);
          const req = store.put(item);
          req.onsuccess = () => {
            // Also sync to localStorage as redundant backup
            this.syncItemToLocalStorage(lsKey, item);
            resolve(item);
          };
          req.onerror = () => {
            this.syncItemToLocalStorage(lsKey, item);
            resolve(item);
          };
        } catch {
          this.syncItemToLocalStorage(lsKey, item);
          resolve(item);
        }
      });
    }

    this.syncItemToLocalStorage(lsKey, item);
    return item;
  }

  private async deleteRecord(storeName: string, lsKey: string, id: string): Promise<void> {
    if (!this.isBrowser) return;

    const db = await this.initDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction([storeName], 'readwrite');
          const store = tx.objectStore(storeName);
          const req = store.delete(id);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }

    this.deleteFromLocalStorage(lsKey, id);
  }

  private getFromLocalStorage<T>(key: string): T[] {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private syncItemToLocalStorage<T extends { id: string }>(key: string, item: T): void {
    try {
      const list = this.getFromLocalStorage<T>(key);
      const index = list.findIndex(i => i.id === item.id);
      if (index >= 0) {
        list[index] = item;
      } else {
        list.push(item);
      }
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
  }

  private deleteFromLocalStorage(key: string, id: string): void {
    try {
      const list = this.getFromLocalStorage<{ id: string }>(key);
      const updated = list.filter(i => i.id !== id);
      localStorage.setItem(key, JSON.stringify(updated));
    } catch (e) {
      console.warn('LocalStorage delete error', e);
    }
  }

  // ==========================================
  // CUSTOMER SERVICES
  // ==========================================
  getCustomers(search?: string): Observable<Customer[]> {
    if (!this.isBrowser) return of([]);

    return from(
      this.getAllRecords<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY).then(customers => {
        if (!search || !search.trim()) {
          return customers.sort((a, b) => a.name.localeCompare(b.name));
        }
        const q = search.trim().toLowerCase();
        return customers
          .filter(c =>
            c.name.toLowerCase().includes(q) ||
            (c.phone && c.phone.toLowerCase().includes(q)) ||
            (c.address && c.address.toLowerCase().includes(q))
          )
          .sort((a, b) => a.name.localeCompare(b.name));
      })
    );
  }

  getCustomer(id: string): Observable<Customer> {
    if (!this.isBrowser) return of(null as any);

    return from(
      this.getAllRecords<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY).then(customers => {
        const found = customers.find(c => c.id === id);
        if (!found) throw new Error(`Customer with id ${id} not found`);
        return found;
      })
    );
  }

  createCustomer(payload: { name: string; phone?: string; address?: string }): Observable<Customer> {
    const newCustomer: Customer = {
      id: 'cust-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6),
      name: payload.name.trim(),
      phone: payload.phone?.trim() || null,
      address: payload.address?.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return from(this.saveRecord<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY, newCustomer));
  }

  updateCustomer(id: string, payload: Partial<Customer>): Observable<Customer> {
    return from(
      this.getAllRecords<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY).then(async (customers) => {
        const existing = customers.find(c => c.id === id);
        if (!existing) throw new Error(`Customer with id ${id} not found`);

        const updated: Customer = {
          ...existing,
          ...payload,
          id: existing.id,
          updated_at: new Date().toISOString()
        };

        await this.saveRecord<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY, updated);

        // Also update any schedules referencing this customer
        const schedules = await this.getAllRecords<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY);
        for (const s of schedules) {
          if (s.customer_id === id) {
            s.customer_name = updated.name;
            s.customer_phone = updated.phone;
            s.customer_address = updated.address;
            await this.saveRecord<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY, s);
          }
        }

        return updated;
      })
    );
  }

  deleteCustomer(id: string): Observable<{ id: string }> {
    return from(
      (async () => {
        await this.deleteRecord(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY, id);

        // Also delete any associated schedules
        const schedules = await this.getAllRecords<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY);
        for (const s of schedules) {
          if (s.customer_id === id) {
            await this.deleteRecord(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY, s.id);
          }
        }
        return { id };
      })()
    );
  }

  // ==========================================
  // SCHEDULE SERVICES
  // ==========================================
  getSchedules(filters?: { status?: string; customer_id?: string; search?: string }): Observable<DeliverySchedule[]> {
    if (!this.isBrowser) return of([]);

    return from(
      (async () => {
        const [customers, rawSchedules] = await Promise.all([
          this.getAllRecords<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY),
          this.getAllRecords<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY)
        ]);

        let schedules = this.syncStatuses(rawSchedules, customers);

        if (filters) {
          if (filters.status && filters.status !== 'ALL') {
            const filterStat = filters.status.toUpperCase();
            schedules = schedules.filter(s => s.status.toUpperCase() === filterStat);
          }
          if (filters.customer_id) {
            schedules = schedules.filter(s => s.customer_id === filters.customer_id);
          }
          if (filters.search && filters.search.trim()) {
            const q = filters.search.trim().toLowerCase();
            schedules = schedules.filter(s =>
              s.medicine_name.toLowerCase().includes(q) ||
              (s.customer_name && s.customer_name.toLowerCase().includes(q)) ||
              (s.notes && s.notes.toLowerCase().includes(q))
            );
          }
        }

        return schedules.sort((a, b) => {
          return new Date(a.next_schedule_date).getTime() - new Date(b.next_schedule_date).getTime();
        });
      })()
    );
  }

  getSchedule(id: string): Observable<DeliverySchedule> {
    if (!this.isBrowser) return of(null as any);

    return from(
      (async () => {
        const [customers, rawSchedules] = await Promise.all([
          this.getAllRecords<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY),
          this.getAllRecords<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY)
        ]);
        const synced = this.syncStatuses(rawSchedules, customers);
        const item = synced.find(s => s.id === id);
        if (!item) throw new Error(`Schedule ${id} not found`);
        return item;
      })()
    );
  }

  createSchedule(payload: {
    customer_id: string;
    medicine_name: string;
    last_delivered_date?: string;
    next_schedule_date?: string;
    interval_days?: number;
    notes?: string;
  }): Observable<DeliverySchedule> {
    return from(
      (async () => {
        const customers = await this.getAllRecords<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY);
        const customer = customers.find(c => c.id === payload.customer_id);

        const todayStr = new Date().toISOString().split('T')[0];
        let nextDateStr = payload.next_schedule_date;

        const interval = payload.interval_days ? Number(payload.interval_days) : 30;
        if (!nextDateStr) {
          const target = new Date();
          target.setDate(target.getDate() + interval);
          nextDateStr = target.toISOString().split('T')[0];
        }

        const newSchedule: DeliverySchedule = {
          id: 'sched-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6),
          customer_id: payload.customer_id,
          customer_name: customer ? customer.name : '',
          customer_phone: customer ? customer.phone : '',
          customer_address: customer ? customer.address : '',
          medicine_name: payload.medicine_name.trim(),
          last_delivered_date: payload.last_delivered_date || todayStr,
          next_schedule_date: nextDateStr,
          interval_days: interval,
          status: 'PENDING',
          notes: payload.notes?.trim() || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        newSchedule.status = this.computeStatus(newSchedule);
        await this.saveRecord<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY, newSchedule);
        return newSchedule;
      })()
    );
  }

  updateSchedule(id: string, payload: Partial<DeliverySchedule>): Observable<DeliverySchedule> {
    return from(
      (async () => {
        const rawSchedules = await this.getAllRecords<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY);
        const existing = rawSchedules.find(s => s.id === id);
        if (!existing) throw new Error(`Schedule with id ${id} not found`);

        const updated: DeliverySchedule = {
          ...existing,
          ...payload,
          id: existing.id,
          interval_days: payload.interval_days ? Number(payload.interval_days) : existing.interval_days,
          updated_at: new Date().toISOString()
        };

        if (payload.next_schedule_date && updated.status !== 'COMPLETED') {
          updated.status = this.computeStatus(updated);
        }

        await this.saveRecord<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY, updated);
        return updated;
      })()
    );
  }

  markDelivered(
    id: string,
    payload: { next_cycle_days?: number; complete_only?: boolean; notes?: string } = { next_cycle_days: 30 }
  ): Observable<DeliverySchedule> {
    return from(
      (async () => {
        const rawSchedules = await this.getAllRecords<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY);
        const schedule = rawSchedules.find(s => s.id === id);
        if (!schedule) throw new Error(`Schedule ${id} not found`);

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        schedule.last_delivered_date = todayStr;
        schedule.updated_at = new Date().toISOString();

        if (payload.complete_only) {
          schedule.status = 'COMPLETED';
        } else {
          const days = payload.next_cycle_days ? Number(payload.next_cycle_days) : (schedule.interval_days || 30);
          schedule.interval_days = days;
          const next = new Date(today);
          next.setDate(today.getDate() + days);
          schedule.next_schedule_date = next.toISOString().split('T')[0];
          schedule.status = this.computeStatus(schedule);
        }

        if (payload.notes) {
          const existingNotes = schedule.notes ? `${schedule.notes}\n` : '';
          schedule.notes = `${existingNotes}[Delivered on ${todayStr}]: ${payload.notes}`.trim();
        }

        await this.saveRecord<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY, schedule);
        return schedule;
      })()
    );
  }

  deleteSchedule(id: string): Observable<{ id: string }> {
    return from(
      this.deleteRecord(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY, id).then(() => ({ id }))
    );
  }

  // ==========================================
  // DASHBOARD METRICS & ANALYTICS
  // ==========================================
  getDashboardStats(): Observable<DashboardStats> {
    if (!this.isBrowser) {
      return of({
        total_customers: 0,
        total_schedules: 0,
        due_today: 0,
        overdue: 0,
        pending: 0,
        completed: 0,
        due_this_week: 0,
        urgent_schedules: []
      });
    }

    return from(
      (async () => {
        const [customers, rawSchedules] = await Promise.all([
          this.getAllRecords<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY),
          this.getAllRecords<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY)
        ]);

        const schedules = this.syncStatuses(rawSchedules, customers);

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split('T')[0];

        let dueToday = 0;
        let overdue = 0;
        let pending = 0;
        let completed = 0;
        let dueThisWeek = 0;

        const urgent: DeliverySchedule[] = [];

        for (const s of schedules) {
          if (s.status === 'COMPLETED') {
            completed++;
          } else if (s.status === 'OVER_DUE') {
            overdue++;
            urgent.push(s);
          } else if (s.status === 'DUE_TODAY') {
            dueToday++;
            urgent.push(s);
          } else {
            pending++;
          }

          if (s.status !== 'COMPLETED' && s.next_schedule_date) {
            const d = s.next_schedule_date.substring(0, 10);
            if (d >= todayStr && d <= nextWeekStr) {
              dueThisWeek++;
            }
          }
        }

        // Sort urgent schedules by schedule date ascending
        urgent.sort((a, b) => new Date(a.next_schedule_date).getTime() - new Date(b.next_schedule_date).getTime());

        return {
          total_customers: customers.length,
          total_schedules: schedules.length,
          due_today: dueToday,
          overdue: overdue,
          pending: pending,
          completed: completed,
          due_this_week: dueThisWeek,
          urgent_schedules: urgent.slice(0, 10)
        };
      })()
    );
  }

  // ==========================================
  // BACKUP & RESTORE FOR STANDALONE PHONE USE
  // ==========================================
  async exportBackup(): Promise<string> {
    const [customers, schedules] = await Promise.all([
      this.getAllRecords<Customer>(STORE_CUSTOMERS, LOCAL_STORAGE_CUSTOMERS_KEY),
      this.getAllRecords<DeliverySchedule>(STORE_SCHEDULES, LOCAL_STORAGE_SCHEDULES_KEY)
    ]);
    return JSON.stringify({ version: 1, exported_at: new Date().toISOString(), customers, schedules }, null, 2);
  }

  async importBackup(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);
      if (Array.isArray(data.customers) && Array.isArray(data.schedules)) {
        const db = await this.initDb();
        if (db) {
          const tx = db.transaction([STORE_CUSTOMERS, STORE_SCHEDULES], 'readwrite');
          const cStore = tx.objectStore(STORE_CUSTOMERS);
          const sStore = tx.objectStore(STORE_SCHEDULES);
          cStore.clear();
          sStore.clear();
          data.customers.forEach((c: Customer) => cStore.put(c));
          data.schedules.forEach((s: DeliverySchedule) => sStore.put(s));
        }
        localStorage.setItem(LOCAL_STORAGE_CUSTOMERS_KEY, JSON.stringify(data.customers));
        localStorage.setItem(LOCAL_STORAGE_SCHEDULES_KEY, JSON.stringify(data.schedules));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async clearAllData(): Promise<void> {
    const db = await this.initDb();
    if (db) {
      try {
        const tx = db.transaction([STORE_CUSTOMERS, STORE_SCHEDULES], 'readwrite');
        const cStore = tx.objectStore(STORE_CUSTOMERS);
        const sStore = tx.objectStore(STORE_SCHEDULES);
        cStore.clear();
        sStore.clear();
      } catch (e) {
        console.warn('Error clearing IndexedDB:', e);
      }
    }
    try {
      localStorage.setItem(LOCAL_STORAGE_CUSTOMERS_KEY, JSON.stringify([]));
      localStorage.setItem(LOCAL_STORAGE_SCHEDULES_KEY, JSON.stringify([]));
    } catch (e) {
      console.warn('Error clearing LocalStorage:', e);
    }
  }
}
