import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalDbService } from './local-db.service';
import { ToastService } from './toast.service';
import { DeliverySchedule, DashboardStats } from '../models/schedule.model';

@Injectable({
  providedIn: 'root'
})
export class PdfExportService {
  private localDb = inject(LocalDbService);
  private toastService = inject(ToastService);

  async exportSchedulesPdf(): Promise<void> {
    try {
      this.toastService.info('Generating PDF report...', 'Please wait');

      // Fetch all schedules and current dashboard stats
      const [schedules, stats] = await Promise.all([
        new Promise<DeliverySchedule[]>((resolve) => {
          this.localDb.getSchedules().subscribe({
            next: (data: DeliverySchedule[]) => resolve(data),
            error: () => resolve([])
          });
        }),
        new Promise<DashboardStats>((resolve) => {
          this.localDb.getDashboardStats().subscribe({
            next: (data: DashboardStats) => resolve(data),
            error: () => resolve({
              total_customers: 0,
              total_schedules: 0,
              due_today: 0,
              overdue: 0,
              pending: 0,
              completed: 0,
              due_this_week: 0,
              urgent_schedules: []
            })
          });
        })
      ]);

      if (schedules.length === 0) {
        this.toastService.warning('No schedules found to export. Please add schedules first.');
        return;
      }

      // Initialize jsPDF (Landscape format for detailed pharmacy table)
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const todayStr = new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      const timeStr = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });

      // 1. HEADER BANNER
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, pageWidth, 75, 'F');

      // Title & Subtitle
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('Pharmacy Medicine Delivery Schedules', 30, 36);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`Official Dispatch & Refill Tracking Report  •  Generated on ${todayStr} at ${timeStr}`, 30, 56);

      // 2. SUMMARY METRICS CARDS
      const cardY = 90;
      const cardWidth = (pageWidth - 60 - 45) / 4;
      const cardHeight = 44;

      const metrics = [
        { label: 'Total Refills', value: String(stats.total_schedules), color: [14, 165, 233] },      // Sky
        { label: 'Due Today', value: String(stats.due_today), color: [245, 158, 11] },              // Amber
        { label: 'Overdue Deliveries', value: String(stats.overdue), color: [239, 68, 68] },        // Red
        { label: 'Pending Upcoming', value: String(stats.pending), color: [99, 102, 241] }          // Indigo
      ];

      metrics.forEach((metric, index) => {
        const x = 30 + index * (cardWidth + 15);
        // Card background
        doc.setFillColor(248, 250, 252); // slate-50
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.roundedRect(x, cardY, cardWidth, cardHeight, 4, 4, 'FD');

        // Color indicator pill
        doc.setFillColor(metric.color[0], metric.color[1], metric.color[2]);
        doc.roundedRect(x + 10, cardY + 12, 4, 20, 2, 2, 'F');

        // Label
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139); // slate-500
        doc.text(metric.label.toUpperCase(), x + 20, cardY + 20);

        // Value
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42); // slate-900
        doc.text(metric.value, x + 20, cardY + 36);
      });

      // 3. TABLE DATA PREPARATION
      const tableHeaders = [
        '#',
        'Status',
        'Patient / Customer',
        'Phone',
        'Medicine & Dosage',
        'Last Delivered',
        'Next Refill Date',
        'Delivery Address & Notes'
      ];

      const tableData = schedules.map((s, idx) => {
        const statusLabel = s.status ? s.status.replace('_', ' ') : 'PENDING';
        const addressAndNotes = [
          s.customer_address ? `📍 ${s.customer_address}` : '',
          s.notes ? `📝 ${s.notes}` : ''
        ].filter(Boolean).join('\n');

        return [
          String(idx + 1),
          statusLabel,
          s.customer_name || 'Patient',
          s.customer_phone || '-',
          s.medicine_name,
          s.last_delivered_date || '-',
          s.next_schedule_date || '-',
          addressAndNotes || '-'
        ];
      });

      // 4. AUTOTABLE RENDERING
      autoTable(doc, {
        startY: 150,
        head: [tableHeaders],
        body: tableData,
        theme: 'grid',
        headStyles: {
          fillColor: [30, 41, 59], // slate-800
          textColor: [255, 255, 255],
          fontSize: 9,
          fontStyle: 'bold',
          halign: 'left',
          cellPadding: 7
        },
        bodyStyles: {
          fontSize: 8.5,
          textColor: [30, 41, 59],
          cellPadding: 6,
          valign: 'top'
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        columnStyles: {
          0: { cellWidth: 25, halign: 'center' },
          1: { cellWidth: 70, fontStyle: 'bold' },
          2: { cellWidth: 105, fontStyle: 'bold' },
          3: { cellWidth: 85 },
          4: { cellWidth: 130, fontStyle: 'bold' },
          5: { cellWidth: 75 },
          6: { cellWidth: 80, fontStyle: 'bold' },
          7: { cellWidth: 'auto' }
        },
        didParseCell: (data) => {
          // Color code status text
          if (data.section === 'body' && data.column.index === 1) {
            const val = String(data.cell.raw).toUpperCase();
            if (val.includes('OVER')) {
              data.cell.styles.textColor = [220, 38, 38]; // red-600
            } else if (val.includes('TODAY')) {
              data.cell.styles.textColor = [217, 119, 6]; // amber-600
            } else if (val.includes('COMPLETED')) {
              data.cell.styles.textColor = [16, 185, 129]; // emerald-600
            } else {
              data.cell.styles.textColor = [2, 132, 199]; // sky-600
            }
          }
        },
        didDrawPage: (data) => {
          // Footer on each page
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(148, 163, 184);
          doc.text(
            'Pharmacy Delivery Remainder • Automated Patient Refill System',
            30,
            pageHeight - 15
          );
          const pageStr = `Page ${data.pageNumber}`;
          doc.text(pageStr, pageWidth - 30 - doc.getTextWidth(pageStr), pageHeight - 15);
        },
        margin: { left: 30, right: 30, bottom: 30 }
      });

      // 5. SAVE / DOWNLOAD / SHARE BASED ON PLATFORM
      const filename = `Pharmacy_Schedules_${new Date().toISOString().substring(0, 10)}.pdf`;

      if (Capacitor.isNativePlatform()) {
        // Native Android/iOS: Write to Cache and present Native Share Sheet / Save to Downloads
        const base64Data = doc.output('datauristring').split(',')[1];
        const writeResult = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Cache
        });

        await Share.share({
          title: 'Pharmacy Delivery Schedules',
          text: `Pharmacy Delivery Schedules Report (${schedules.length} records)`,
          url: writeResult.uri,
          dialogTitle: 'Save or Share PDF Report'
        });

        this.toastService.success('PDF report ready! Choose where to save or open.');
      } else {
        // Standard Web Browser: Direct download
        doc.save(filename);
        this.toastService.success('PDF report downloaded successfully!');
      }
    } catch (err: any) {
      console.error('PDF generation error:', err);
      this.toastService.error('Failed to generate PDF: ' + (err?.message || 'Unknown error'));
    }
  }
}
