import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { ScheduleService } from '../../services/schedule.service';
import { LocalDbService } from '../../services/local-db.service';
import { PdfExportService } from '../../services/pdf-export.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, FormsModule],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css'
})
export class LayoutComponent implements OnInit {
  authService = inject(AuthService);
  toastService = inject(ToastService);
  private scheduleService = inject(ScheduleService);
  private localDb = inject(LocalDbService);
  private pdfExportService = inject(PdfExportService);

  userEmail = this.authService.getUserEmail();
  toasts$ = this.toastService.toasts$;
  urgentCount = 0;
  isExportingPdf = false;

  ngOnInit() {
    this.refreshBadges();
  }

  refreshBadges() {
    this.scheduleService.getDashboardStats().subscribe({
      next: (stats) => {
        this.urgentCount = (stats.due_today || 0) + (stats.overdue || 0);
      },
      error: () => {}
    });
  }

  logout() {
    this.authService.logout();
  }

  removeToast(id: string) {
    this.toastService.remove(id);
  }

  async downloadPdf() {
    if (this.isExportingPdf) return;
    this.isExportingPdf = true;
    try {
      await this.pdfExportService.exportSchedulesPdf();
    } finally {
      this.isExportingPdf = false;
    }
  }

  async clearAllData() {
    if (confirm('Are you sure you want to delete all customers and schedules? This will give you a completely clean, empty app.')) {
      try {
        await this.localDb.clearAllData();
        this.toastService.success('All data wiped! Database is completely empty.');
        this.refreshBadges();
        window.location.reload();
      } catch {
        this.toastService.error('Failed to clear data');
      }
    }
  }
}
