/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySecret } from '@/lib/crypto';
import { generateExportData } from '@/lib/export';
import { sendEmail } from '@/lib/email/service';
import type { EmailAttachment } from '@/lib/email/service';
import { renderReportPdf } from '@/lib/pdf/render';
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { scheduledReports } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { acquireLock, releaseLock } from '@/lib/cache';

const REPORT_LOCK_KEY = 'cron:scheduled-report-delivery';
const REPORT_LOCK_TTL = 120; // 2 minutes

/**
 * Scheduled Report Delivery cron
 *
 * Picks due (next_run_at <= now) active scheduled reports, generates the CSV
 * via lib/export/index.ts and emails it to the configured recipients via
 * lib/email/service.ts. Advances nextRunAt per the report frequency.
 *
 * The generated report is delivered as a real file attachment (#1614): a .csv
 * by default, or a .pdf rendered via lib/pdf when the report's configured
 * format is 'pdf'. The email body is a short message; the data is no longer
 * inlined into an HTML block.
 */

type ExportEntityType = 'contacts' | 'deals' | 'tasks' | 'companies';

/** Map a scheduled report's type to an entity supported by generateExportData */
function exportEntityFor(reportType: string): ExportEntityType {
  switch (reportType) {
    case 'deals':
      return 'deals';
    case 'tasks':
      return 'tasks';
    case 'companies':
      return 'companies';
    case 'leads':
    case 'summary':
    default:
      return 'contacts';
  }
}

/** Compute the next run based on frequency (mirrors scheduled/route.ts:47-53) */
function computeNextRunAt(frequency: string): Date {
  const next = new Date();
  switch (frequency) {
    case 'hourly': next.setHours(next.getHours() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'monthly': next.setMonth(next.getMonth() + 1); break;
    case 'daily':
    default:
      next.setDate(next.getDate() + 1); break;
  }
  return next;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Strip characters that are unsafe in a filename, collapsing to a safe stem. */
function toSafeFilename(name: string): string {
  const cleaned = String(name || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
  return cleaned || 'report';
}

/**
 * Parse a CSV string produced by generateExportData into a header row plus data
 * rows for tabular PDF rendering. escapeCSV wraps fields containing commas,
 * quotes, or newlines in double quotes and doubles embedded quotes, so this
 * parser honours quoted fields (including quoted commas and newlines).
 */
function parseCsv(csv: string): { columns: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => { pushField(); records.push(record); record = []; };

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRecord();
    } else if (ch === '\r') {
      // skip; handled by the following \n (or end of input)
    } else {
      field += ch;
    }
  }
  // Flush any trailing field/record that was not newline-terminated.
  if (field.length > 0 || record.length > 0) pushRecord();

  const columns = records.length > 0 ? (records[0] ?? []) : [];
  const rows = records.slice(1);
  return { columns, rows };
}

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const lock = await acquireLock(REPORT_LOCK_KEY, REPORT_LOCK_TTL);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Another instance running' });
  }

  let delivered = 0;
  try {
    const dueRows = await db
      .select({
        id: scheduledReports.id,
        tenantId: scheduledReports.tenantId,
        name: scheduledReports.name,
        type: scheduledReports.type,
        frequency: scheduledReports.frequency,
        recipients: scheduledReports.recipients,
        format: scheduledReports.format,
        config: scheduledReports.config,
      })
      .from(scheduledReports)
      .where(and(
        eq(scheduledReports.status, 'active'),
        isNull(scheduledReports.deletedAt),
        sql`${scheduledReports.nextRunAt} <= NOW()`
      ))
      .limit(50);

    for (const report of dueRows) {
      try {
        // #1276: A scheduled report is tenant-scoped and already authorized at
        // scheduling time, so it runs with a system/cron identity rather than an
        // empty userId. generateExportData scopes every query by tenantId only
        // (it does not filter or gate by userId), so passing a stable system
        // marker keeps behaviour identical while avoiding the empty-string that
        // could trip user-level access checks if the export layer adds them.
        const csv = await generateExportData({
          tenantId: report.tenantId,
          userId: 'system:cron',
          entityType: exportEntityFor(report.type),
        });

        const recipients = (Array.isArray(report.recipients) ? report.recipients : [])
          .map(r => String(r))
          .filter(r => typeof r === 'string' && r.includes('@'));

        if (recipients.length === 0) {
          console.warn(`[scheduled-report] ${report.id}: no recipients, skipping send`);
        } else {
          // #1614: deliver the report as a real file attachment instead of
          // inlining the CSV into the HTML body. CSV by default; render a PDF
          // via lib/pdf when the report's configured format is 'pdf'.
          const format = String(report.format || 'csv').toLowerCase();
          const safeName = toSafeFilename(report.name);
          let attachment: EmailAttachment;
          if (format === 'pdf') {
            const { columns, rows } = parseCsv(csv || '');
            const pdfBuffer = await renderReportPdf({
              title: report.name,
              columns,
              rows,
            });
            attachment = {
              filename: `${safeName}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            };
          } else {
            attachment = {
              filename: `${safeName}.csv`,
              content: Buffer.from(csv || '', 'utf8'),
              contentType: 'text/csv',
            };
          }

          await sendEmail({
            to: recipients,
            subject: `Scheduled report: ${report.name} (${report.format?.toUpperCase?.() ?? 'CSV'})`,
            text: `Your scheduled report ${report.name} (${report.type}) is attached.`,
            html: `<p>Your scheduled report <strong>${escapeHtml(report.name)}</strong> (${escapeHtml(report.type)}) is attached.</p>`,
            attachments: [attachment],
          });
        }

        // Success: reset the failure counter and advance to the next run.
        const baseConfig = (report.config && typeof report.config === 'object')
          ? report.config as Record<string, unknown>
          : {};
        const { _failureCount: _fc, _lastError: _le, ...cleanConfig } = baseConfig;
        void _fc; void _le;
        await db.update(scheduledReports).set({
          lastRunAt: new Date(),
          nextRunAt: computeNextRunAt(report.frequency),
          status: 'active',
          config: cleanConfig,
          updatedAt: new Date(),
        }).where(eq(scheduledReports.id, report.id));

        delivered += 1;
      } catch (err) {
        // #1466: A single transient failure must NOT permanently disable the
        // report. Previously we set status='error' and left nextRunAt in the
        // past — but the due query only selects status='active', so the report
        // was never retried and silently died. Instead, keep it active and
        // advance nextRunAt so it retries next cycle, tracking consecutive
        // failures; only give up (status='error') after MAX_CONSECUTIVE_FAILURES.
        await logError({ error: err, context: 'scheduled-report-delivery' });
        const MAX_CONSECUTIVE_FAILURES = 5;
        const baseConfig = (report.config && typeof report.config === 'object')
          ? report.config as Record<string, unknown>
          : {};
        const failureCount = (Number(baseConfig['_failureCount']) || 0) + 1;
        const giveUp = failureCount >= MAX_CONSECUTIVE_FAILURES;
        await db.update(scheduledReports).set({
          status: giveUp ? 'error' : 'active',
          nextRunAt: giveUp ? null : computeNextRunAt(report.frequency),
          config: {
            ...baseConfig,
            _failureCount: failureCount,
            _lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
          },
          updatedAt: new Date(),
        }).where(eq(scheduledReports.id, report.id));
      }
    }

    return NextResponse.json({ ok: true, delivered, skipped: dueRows.length - delivered });
  } catch (err) {
    await logError({ error: err, context: 'scheduled-report-delivery' });
    return NextResponse.json({ ok: false, error: 'Failed to deliver scheduled reports' }, { status: 500 });
  } finally {
    await releaseLock(REPORT_LOCK_KEY, lock.value);
  }
}