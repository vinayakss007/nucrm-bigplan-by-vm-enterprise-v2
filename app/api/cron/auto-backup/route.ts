/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { acquireLock } from '@/lib/cache';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { setSuperAdminContext, setTenantContext } from '@/lib/db/rls';
import { withApiRoute } from '@/lib/api/with-api-route';
import { verifyCronSecret } from '@/lib/auth/cron';
import { TenantDataExporter } from '@/lib/tenant-data-export';
import { sendAlertEmail } from '@/lib/email/alerts';


/**
 * Automated Backup Scheduler
 * 
 * Called by cron every hour — checks if any backups are due and runs them.
 * Supports: daily, weekly, monthly schedules with 90-day retention.
 * 
 * Usage: curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/auto-backup
 */

const BACKUP_RETENTION_DAYS = 90;
const CRITICAL_TABLES = [
  'tenants', 'contacts', 'leads', 'deals', 'companies',
  'tasks', 'tenant_members', 'roles', 'invitations',
  'subscriptions', 'audit_logs', 'activities',
];

export const POST = withApiRoute(async (req: NextRequest) => {
  // Verify cron secret
  const verified = await verifyCronSecret(req);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:auto-backup', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  // Platform maintenance runs cross-tenant (all schedules, all tenants), so
  // it cannot use a tenant context. The super-admin GUC is set on the pinned
  // client that withApiRoute holds for this request, so EVERY query below —
  // including TenantDataExporter's global-db reads — carries it. The
  // fail-closed RLS policies admit the super-admin context, and the pin
  // teardown resets the GUCs so nothing leaks to the next checkout.
  await setSuperAdminContext();

  // 1. Run scheduled backups
  const scheduledResult = await runScheduledBackups();

  // 2. Clean up expired backups
  const cleanupResult = await cleanupExpiredBackups();

  // 3. Purge critical data older than 90 days
  const purgeResult = await purgeExpiredCriticalBackups();

  return NextResponse.json({
    message: 'Auto-backup complete',
    scheduled: scheduledResult,
    cleaned: cleanupResult,
    purged: purgeResult,
  });
});

export const GET = POST;

// ── Run Due Backups ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

async function runScheduledBackups() {
  const _now = new Date();
  let backupsRun = 0;
  let errors = 0;
  let skipped = 0;
  // #2127: a run that reports success while silently excluding tenants is
  // worse than a failure — track who was skipped so we can alert loudly.
  const skippedTenants: string[] = [];

  // Get all enabled schedules that are due
  const schedules = await db.execute(sql`
    SELECT * FROM backup_schedules
    WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= NOW())
    ORDER BY next_run_at ASC NULLS FIRST`
  );
  const rows = schedules.rows as AnyRow[];

  if (rows.length === 0) {
    // No schedule is currently DUE. That does not mean no schedule exists —
    // an existing global schedule whose next_run_at is in the future also
    // yields zero rows here. backup_schedules has no unique constraint, so the
    // previous `ON CONFLICT DO NOTHING` never fired and a duplicate default
    // was inserted on every run. Guard on the actual existence of a global
    // schedule (tenant_id IS NULL) and only create the default when none exist.
    const globalExists = await db.execute(sql`
      SELECT 1 FROM backup_schedules WHERE tenant_id IS NULL LIMIT 1`
    );
    if (globalExists.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO backup_schedules (schedule_type, backup_type, retention_days, enabled, next_run_at)
        VALUES ('monthly', 'full', ${BACKUP_RETENTION_DAYS}, true, NOW() + INTERVAL '1 hour')
        ON CONFLICT DO NOTHING`
      );
      return { message: 'Created default monthly backup schedule', backupsRun: 0 };
    }
    return { message: 'No backups due', backupsRun: 0 };
  }

  for (const schedule of rows) {
    try {
      if (schedule.tenant_id) {
        // Per-tenant backup
        const res = await backupSingleTenant(schedule.tenant_id, schedule) as AnyRow | undefined;
        if (res?.skipped) {
          skipped++;
          if (res.tenantId) skippedTenants.push(String(res.tenantId));
        }
      } else {
        // Global — backup ALL tenants
        const tenants = await db.execute(sql`SELECT id FROM tenants WHERE status != ${'suspended'}`);
        for (const tenant of tenants.rows as AnyRow[]) {
          const res = await backupSingleTenant(tenant.id, schedule) as AnyRow | undefined;
          if (res?.skipped) {
            skipped++;
            if (res.tenantId) skippedTenants.push(String(res.tenantId));
          }
        }
      }

      // Update schedule next run time
      const nextRun = calculateNextRun(schedule.schedule_type);
      await db.execute(sql`
        UPDATE backup_schedules SET last_run_at = NOW(), next_run_at = ${nextRun}, updated_at = NOW() WHERE id = ${schedule.id}`
      );

      backupsRun++;


    } catch (err) {
      void logError({ error: err, context: 'cron/auto-backup schedule', metadata: { scheduleId: schedule.id } });
      errors++;
    }
  }

  // #2127: skipped tenants mean the "green" nightly run did NOT back up their
  // data. Surface the list in the response and page the super admin by email
  // (backup failures already alert per-tenant; skips were silent).
  if (skippedTenants.length > 0) {
    const detail = `Tenants skipped by auto-backup (no owner and no active members — their data is NOT in this run's backups):\n${skippedTenants.map(t => `- ${t}`).join('\n')}`;
    void logError({ error: new Error('auto-backup skipped tenants'), context: 'cron/auto-backup', level: 'warning', metadata: { skippedTenants } });
    try {
      await sendAlertEmail(`Auto-backup incomplete: ${skippedTenants.length} tenant(s) skipped`, detail);
    } catch (err) {
      void logError({ error: err, context: 'cron/auto-backup skip-alert email', level: 'warning' });
    }
  }

  return { backupsRun, errors, skipped, skippedTenants };
}

// ── Backup Single Tenant ─────────────────────────────────────────────────────

async function backupSingleTenant(
  tenantId: string,


// eslint-disable-next-line @typescript-eslint/no-explicit-any
  schedule: any
) {
  const backupType = schedule.backup_type || 'full';
  const includeTables = backupType === 'critical_only' ? CRITICAL_TABLES : undefined;
  const retentionDays = schedule.retention_days || BACKUP_RETENTION_DAYS;

  // Per-tenant work must run under THAT tenant's context, not the platform
  // super-admin one (NUCRM-P): tenant_backup_records has no super-admin
  // bypass, and — worse — the exporter's tenant-table reads would silently
  // return zero rows under a tenant-less context, producing EMPTY backups.
  // The tenants table itself carries a bypass, so the owner lookup below
  // works from the platform context. try/finally restores the platform
  // context so the schedule bookkeeping after this call is unaffected, and
  // a throw here can never leak one tenant's GUCs into the next tenant.
  const ownerRow = await db.execute(sql`
    SELECT owner_id FROM tenants WHERE id = ${tenantId} LIMIT 1`
  );
  let contextUserId = (ownerRow.rows[0] as AnyRow | undefined)?.owner_id as string | undefined;
  if (!contextUserId) {
    // Older/provisioned tenants may have no owner_id. Any active member's
    // identity suffices here: the backup only needs a same-tenant
    // current_user so the fail-closed policies admit the reads/writes.
    // Prefer an admin, fall back to the earliest active member.
    const memberRow = await db.execute(sql`
      SELECT user_id FROM tenant_members
      WHERE tenant_id = ${tenantId} AND status = 'active'
      ORDER BY (role_slug = 'admin') DESC, joined_at ASC NULLS LAST
      LIMIT 1`
    );
    contextUserId = (memberRow.rows[0] as AnyRow | undefined)?.user_id as string | undefined;
  }
  if (!contextUserId) {
    // Orphan tenant: no owner and no active members means no data can exist
    // under it either (all writes require membership). Skip quietly instead
    // of failing the whole run.
    return { skipped: true, reason: 'no-members', tenantId } as AnyRow;
  }
  await setTenantContext(tenantId, contextUserId);

  try {
  // Create backup record
  const record = await db.execute(sql`
    INSERT INTO tenant_backup_records (tenant_id, status, backup_type, initiated_auto, retention_days, include_tables, created_at)
    VALUES (${tenantId}, 'running', ${backupType}, true, ${retentionDays}, ${includeTables ? JSON.stringify(includeTables) : null}, NOW())
    RETURNING *`
  );

  const backupRecord = record.rows[0] as AnyRow;

  try {
    const exporter = new TenantDataExporter(tenantId);
    const result = await exporter.exportAll(includeTables);

    await db.execute(sql`
      UPDATE tenant_backup_records
      SET status = 'completed',
          data_size = ${result.dataSize},
          table_count = ${result.tableCount},
          record_count = ${result.totalRecords},
          backup_data = ${JSON.stringify(result.tables)},
          duration_ms = EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000,
          completed_at = NOW()
      WHERE id = ${backupRecord.id}`
    );


// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await db.execute(sql`
      UPDATE tenant_backup_records SET status = 'failed', error_message = ${err.message}, completed_at = NOW() WHERE id = ${backupRecord.id}`
    );

    // Alert super admin
    try {
      const tenantInfo = await db.execute(sql`SELECT name FROM tenants WHERE id = ${tenantId}`);
      const tenantName = (tenantInfo.rows[0] as AnyRow | undefined)?.name || tenantId;
      await sendAlertEmail(
        `Backup Failed: ${tenantName}`,
        `Backup failed for tenant ${tenantName}: ${err.message}`,
      );
    } catch (err) {
      void logError({ error: err, context: 'cron/auto-backup email alert', level: 'warning' });
    }

    throw err;
  }
  } finally {
    await setSuperAdminContext();
  }
}

// ── Clean Up Expired Backups ─────────────────────────────────────────────────

async function cleanupExpiredBackups() {
  // Delete backups past their retention period
  const result = await db.execute(sql`
    DELETE FROM tenant_backup_records
    WHERE status = 'completed'
      AND expires_at < NOW()
    RETURNING id, tenant_id`
  );

  return { cleaned: result.rows.length };
}

// ── Purge Critical Data Backups Past 90 Days ─────────────────────────────────

async function purgeExpiredCriticalBackups() {
  const result = await db.execute(sql`
    DELETE FROM critical_data_backups
    WHERE retained_until < NOW()
    RETURNING id, tenant_id, table_name, record_id`
  );

  return { purged: result.rows.length };
}

// ── Calculate Next Run Time ──────────────────────────────────────────────────

function calculateNextRun(scheduleType: string): Date {
  const now = new Date();
  switch (scheduleType) {
    case 'daily':
      now.setDate(now.getDate() + 1);
      now.setHours(2, 0, 0, 0); // 2 AM
      break;
    case 'weekly':
      now.setDate(now.getDate() + 7);
      now.setHours(3, 0, 0, 0); // 3 AM Sunday
      break;
    case 'monthly':
    default:
      now.setMonth(now.getMonth() + 1);
      now.setDate(1);
      now.setHours(4, 0, 0, 0); // 4 AM 1st of month
      break;
  }
  return now;
}
