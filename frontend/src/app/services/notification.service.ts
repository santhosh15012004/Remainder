import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LocalNotifications, PendingResult } from '@capacitor/local-notifications';
import { DeliverySchedule } from '../models/schedule.model';
import { ToastService } from './toast.service';

const NOTIFICATION_CHANNEL_ID = 'remainder_delivery_channel';
const STORAGE_PREFS_KEY = 'remainder_notification_prefs_v1';

export interface NotificationPrefs {
  remindOneDayBefore: boolean; // Remind tomorrow
  remindOnDayOfDelivery: boolean; // Remind today
  reminderHour: number; // e.g. 9 for 9:00 AM
  reminderMinute: number; // e.g. 0 for 9:00 AM
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private platformId = inject(PLATFORM_ID);
  private toastService = inject(ToastService);
  private isBrowser = isPlatformBrowser(this.platformId);

  private prefs: NotificationPrefs = {
    remindOneDayBefore: true,
    remindOnDayOfDelivery: true,
    reminderHour: 9,
    reminderMinute: 0
  };

  constructor() {
    if (this.isBrowser) {
      this.loadPrefs();
      this.initChannel();
    }
  }

  private loadPrefs() {
    try {
      const saved = localStorage.getItem(STORAGE_PREFS_KEY);
      if (saved) {
        this.prefs = { ...this.prefs, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Could not read notification preferences:', e);
    }
  }

  savePrefs(newPrefs: Partial<NotificationPrefs>) {
    this.prefs = { ...this.prefs, ...newPrefs };
    if (this.isBrowser) {
      localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(this.prefs));
    }
  }

  getPrefs(): NotificationPrefs {
    return { ...this.prefs };
  }

  /**
   * Create high-priority Android Notification Channel for lock-screen heads-up alerts
   */
  async initChannel() {
    if (!this.isBrowser) return;
    try {
      await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'Medicine Refill Reminders',
        description: 'Advance reminders for tomorrow and today delivery schedules',
        importance: 5, // High priority: shows heads-up banner, sounds, vibrates
        visibility: 1, // Public: displays on phone lock screen
        vibration: true,
        sound: undefined
      });
    } catch (e) {
      // Channel creation not needed on web or older platforms
    }
  }

  /**
   * Request notification permission from Android / browser
   */
  async requestPermission(): Promise<boolean> {
    if (!this.isBrowser) return false;

    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display === 'granted') {
        return true;
      }
    } catch {
      // Fallback to web
    }

    if ('Notification' in window) {
      const res = await Notification.requestPermission();
      return res === 'granted';
    }

    return false;
  }

  /**
   * Schedules Advance Background Alarms into Android OS:
   * - 1 Day Before (Tomorrow Alert) at user's preferred time (e.g. 9:00 AM)
   * - On Delivery Day (Today Alert) at user's preferred time (e.g. 9:00 AM)
   * 
   * Even when the app is COMPLETELY CLOSED, Android AlarmManager wakes up
   * the phone and triggers the notification alert with banner & sound!
   */
  async syncScheduleAlarms(schedules: DeliverySchedule[]): Promise<number> {
    if (!this.isBrowser || schedules.length === 0) return 0;

    const granted = await this.requestPermission();
    if (!granted) {
      console.warn('Cannot schedule alarms: notification permission not granted.');
      return 0;
    }

    await this.initChannel();

    try {
      // Cancel previous pending alarms before re-scheduling fresh alarms
      const pending: PendingResult = await LocalNotifications.getPending();
      if (pending && pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications });
      }
    } catch (e) {
      console.warn('Could not clear pending notifications:', e);
    }

    const notificationsToSchedule: any[] = [];
    const now = new Date();

    for (const schedule of schedules) {
      // Skip completed schedules
      if (schedule.status === 'COMPLETED' || !schedule.next_schedule_date) continue;

      const dateParts = schedule.next_schedule_date.substring(0, 10).split('-');
      if (dateParts.length !== 3) continue;

      const year = parseInt(dateParts[0], 10);
      const monthIndex = parseInt(dateParts[1], 10) - 1;
      const day = parseInt(dateParts[2], 10);

      const patientName = (schedule.customer_name && schedule.customer_name.trim()) 
        ? schedule.customer_name.trim() 
        : 'Customer';
      const medicine = schedule.medicine_name;
      const baseId = Math.abs(this.hashCode(schedule.id)) % 100000;

      // 1. "TOMORROW IS DELIVERY DATE" ALARM (1 Day Before at preferred hour)
      if (this.prefs.remindOneDayBefore) {
        let tomorrowAlarmDate = new Date(year, monthIndex, day - 1, this.prefs.reminderHour, this.prefs.reminderMinute, 0);

        // Check if delivery date is tomorrow
        const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const schedMid = new Date(year, monthIndex, day).getTime();
        const isTomorrow = (schedMid - todayMid) === 86400000;

        // If delivery is tomorrow and preferred morning hour today has already passed,
        // trigger in 5 seconds so the user receives advance notice today!
        if (isTomorrow && tomorrowAlarmDate.getTime() <= now.getTime()) {
          tomorrowAlarmDate = new Date(Date.now() + 5000);
        }

        if (tomorrowAlarmDate.getTime() > now.getTime()) {
          notificationsToSchedule.push({
            id: baseId * 2 + 1,
            title: `⏰ Tomorrow: Delivery for ${patientName}`,
            body: `Tomorrow is delivery date for ${patientName}: ${medicine}`,
            channelId: NOTIFICATION_CHANNEL_ID,
            schedule: {
              at: tomorrowAlarmDate,
              allowWhileIdle: true // Wakes Android phone even in battery saver / doze mode!
            },
            smallIcon: 'ic_launcher'
          });
        }
      }

      // 2. "TODAY IS DELIVERY DATE" ALARM (On the delivery day at preferred hour)
      if (this.prefs.remindOnDayOfDelivery) {
        let todayAlarmDate = new Date(year, monthIndex, day, this.prefs.reminderHour, this.prefs.reminderMinute, 0);

        const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const schedMid = new Date(year, monthIndex, day).getTime();
        const isToday = schedMid === todayMid;

        // If delivery is today and morning hour passed, trigger in 5 seconds
        if (isToday && todayAlarmDate.getTime() <= now.getTime()) {
          todayAlarmDate = new Date(Date.now() + 5000);
        }

        if (todayAlarmDate.getTime() > now.getTime()) {
          notificationsToSchedule.push({
            id: baseId * 2 + 2,
            title: `💊 Due Today: Delivery for ${patientName}`,
            body: `Today is delivery date for ${patientName}: ${medicine}`,
            channelId: NOTIFICATION_CHANNEL_ID,
            schedule: {
              at: todayAlarmDate,
              allowWhileIdle: true // Wakes phone even when app is closed!
            },
            smallIcon: 'ic_launcher'
          });
        }
      }
    }

    if (notificationsToSchedule.length > 0) {
      try {
        await LocalNotifications.schedule({ notifications: notificationsToSchedule });
        console.log(`Successfully registered ${notificationsToSchedule.length} background alarms with Android.`);
      } catch (err) {
        console.error('Error scheduling alarms with Android AlarmManager:', err);
      }
    }

    return notificationsToSchedule.length;
  }

  /**
   * Get all alarms currently registered in Android's AlarmManager
   */
  async getRegisteredAlarms(): Promise<any[]> {
    if (!this.isBrowser) return [];
    try {
      const pending: PendingResult = await LocalNotifications.getPending();
      return pending ? pending.notifications : [];
    } catch {
      return [];
    }
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}
