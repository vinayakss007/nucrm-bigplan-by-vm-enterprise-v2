/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { acquireLock } from '@/lib/cache';
import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { alertSuperAdmin } from '@/lib/email/service';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { backupAlerts } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';
// backup_alerts INSERT requires the super-admin context and backupRecords
// reads must see across tenants: without a context this job 500s (NUCRM-E)
// or reports a bogus "no backup ever". withApiRoute pins one client and
// setSuperAdminContext (session-scoped, no tx) marks it, so the plain `db`
// calls below inherit the context via the pin (same pattern as auto-backup).
import { withApiRoute } from '@/lib/api/with-api-route';
import { setSuperAdminContext } from '@/lib/db/rls';

// Runs every 6 hours — checks backup health and alerts if backup is overdue
export const POST = withApiRoute(async (request: NextRequest) => {
  const secret = request.headers.get('x-cron-secret');
  if (!verifySecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:backup-health', 1800);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  try {
    await setSuperAdminContext();
    {
    // Health is measured against tenant_backup_records (the table the
    // auto-backup cron actually writes). The legacy backupRecords table is
    // no longer written, so checking it would always raise a false alarm.
    const latest = await db.execute(sql`
      SELECT completed_at, data_size FROM tenant_backup_records
      WHERE status = 'completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1`
    );
    const latestRow = latest.rows[0] as { completed_at: string | null; data_size: string | null } | undefined;
    const lastBackup = latestRow?.completed_at
      ? { completedAt: new Date(latestRow.completed_at), dataSize: latestRow.data_size }
      : undefined;

    const now = Date.now();
    const alertThresholdHours = 25; // Alert if no backup in 25 hours

    if (!lastBackup || !lastBackup.completedAt) {
      // No backup ever — critical
      const alreadyAlerted = await db.query.backupAlerts.findFirst({
        where: and(
          eq(backupAlerts.alertType, 'no_backup'),
          eq(backupAlerts.resolved, false),
          gt(backupAlerts.createdAt, new Date(Date.now() - 6 * 3600000))
        )
      });
      if (!alreadyAlerted) {
        await db.insert(backupAlerts).values({
          alertType: 'no_backup',
          message: 'No backup has ever been completed',
        });
        await alertSuperAdmin(
          'WARNING: No database backup has ever been run',
          'Please configure automated backups immediately.\n\nVisit: /superadmin/backups'
        );
      }
      return NextResponse.json({ ok: false, alert: 'no_backup_ever' });
    }

    const hoursSinceBackup = (now - lastBackup.completedAt.getTime()) / 3600000;

    if (hoursSinceBackup > alertThresholdHours) {
      const alreadyAlerted = await db.query.backupAlerts.findFirst({
        where: and(
          eq(backupAlerts.alertType, 'no_backup'),
          eq(backupAlerts.resolved, false),
          gt(backupAlerts.createdAt, new Date(Date.now() - 6 * 3600000))
        )
      });
      if (!alreadyAlerted) {
        await db.insert(backupAlerts).values({
          alertType: 'no_backup',
          message: `No backup in ${Math.floor(hoursSinceBackup)} hours. Last backup: ${lastBackup.completedAt.toISOString()}`,
        });
        await alertSuperAdmin(
          `WARNING: No backup in ${Math.floor(hoursSinceBackup)} hours`,
          `Last successful backup: ${lastBackup.completedAt.toISOString()}\nSize: ${lastBackup.dataSize ?? 'unknown'}\n\nPlease check the backup cron job.`
        );
      }
      return NextResponse.json({ ok: false, hours_since_backup: hoursSinceBackup });
    }

    return NextResponse.json({
      ok: true,
      last_backup: lastBackup.completedAt,
      hours_since: Math.round(hoursSinceBackup * 10) / 10,
    });
    }


// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});
