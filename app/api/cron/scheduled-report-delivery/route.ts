/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySecret } from '@/lib/crypto';
import { generateExportData } from '@/lib/export';
import { sendEmail } from '@/lib/email/service';
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
 * Generated CSV content is delivered as plain text and as a <pre> block in the
 * HTML body (the generic sendEmail payload has no attachment facility).
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
        const csv = await generateExportData({
          tenantId: report.tenantId,
          userId: '',
          entityType: exportEntityFor(report.type),
        });

        const recipients = (Array.isArray(report.recipients) ? report.recipients : [])
          .map(r => String(r))
          .filter(r => typeof r === 'string' && r.includes('@'));

        if (recipients.length === 0) {
          console.warn(`[scheduled-report] ${report.id}: no recipients, skipping send`);
        } else {
          await sendEmail({
            to: recipients,
            subject: `Scheduled report: ${report.name} (${report.format?.toUpperCase?.() ?? 'CSV'})`,
            text: csv || 'No rows returned for this report period.',
            html: `<p>Your scheduled report <strong>${escapeHtml(report.name)}</strong> (${escapeHtml(report.type)}) is ready.</p><pre style="font-size:11px;white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px;">${escapeHtml(csv || 'No rows returned for this report period.')}</pre>`,
          });
        }

        await db.update(scheduledReports).set({
          lastRunAt: new Date(),
          nextRunAt: computeNextRunAt(report.frequency),
          status: 'active',
          updatedAt: new Date(),
        }).where(eq(scheduledReports.id, report.id));

        delivered += 1;
      } catch (err) {
        await logError({ error: err, context: 'scheduled-report-delivery' });
        await db.update(scheduledReports).set({
          status: 'error',
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