import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verifyCronSecret } from '@/lib/auth/cron';
import { TenantDataExporter } from '@/lib/tenant-data-export';
import { sendAlertEmail } from '@/lib/email/alerts';
import { captureError } from '@/lib/capture-error';

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

export async function POST(req: NextRequest) {
  // Verify cron secret
  const verified = await verifyCronSecret(req);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // FIX MEDIUM-07: Use try/finally to ensure pool is always closed
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // 1. Run scheduled backups
    const scheduledResult = await runScheduledBackups(pool);

    // 2. Clean up expired backups
    const cleanupResult = await cleanupExpiredBackups(pool);

    // 3. Purge critical data older than 90 days
    const purgeResult = await purgeExpiredCriticalBackups(pool);

    return NextResponse.json({
      message: 'Auto-backup complete',
      scheduled: scheduledResult,
      cleaned: cleanupResult,
      purged: purgeResult,
    });
  } finally {
    await pool.end();
  }
}

export async function GET(req: NextRequest) {
  // Allow GET for manual trigger/testing
  return POST(req);
}

// ── Run Due Backups ──────────────────────────────────────────────────────────

async function runScheduledBackups(pool: Pool) {
  const _now = new Date();
  let backupsRun = 0;
  let errors = 0;

  // Get all enabled schedules that are due
  const schedules = await pool.query(
    `SELECT * FROM backup_schedules 
     WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= NOW())
     ORDER BY next_run_at ASC NULLS FIRST`
  );

  if (schedules.rows.length === 0) {
    // No schedules exist — create default global monthly schedule
    await pool.query(
      `INSERT INTO backup_schedules (schedule_type, backup_type, retention_days, enabled, next_run_at)
       VALUES ('monthly', 'full', $1, true, NOW() + INTERVAL '1 hour')
       ON CONFLICT DO NOTHING`,
      [BACKUP_RETENTION_DAYS]
    );
    return { message: 'Created default monthly backup schedule', backupsRun: 0 };
  }

  for (const schedule of schedules.rows) {
    try {
      if (schedule.tenant_id) {
        // Per-tenant backup
        await backupSingleTenant(pool, schedule.tenant_id, schedule);
      } else {
        // Global — backup ALL tenants
        const tenants = await pool.query('SELECT id FROM tenants WHERE status != $1', ['suspended']);
        for (const tenant of tenants.rows) {
          await backupSingleTenant(pool, tenant.id, schedule);
        }
      }

      // Update schedule next run time
      const nextRun = calculateNextRun(schedule.schedule_type);
      await pool.query(
        `UPDATE backup_schedules SET last_run_at = NOW(), next_run_at = $1, updated_at = NOW() WHERE id = $2`,
        [nextRun, schedule.id]
      );

      backupsRun++;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error(`[Auto Backup] Schedule ${schedule.id} failed:`, err);
      errors++;
    }
  }

  return { backupsRun, errors };
}

// ── Backup Single Tenant ─────────────────────────────────────────────────────

async function backupSingleTenant(
  pool: Pool,
  tenantId: string,
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  schedule: any
) {
  const backupType = schedule.backup_type || 'full';
  const includeTables = backupType === 'critical_only' ? CRITICAL_TABLES : undefined;

  // Create backup record
  const record = await pool.query(
    `INSERT INTO tenant_backup_records (tenant_id, status, backup_type, initiated_auto, retention_days, include_tables, created_at)
     VALUES ($1, 'running', $2, true, $3, $4, NOW())
     RETURNING *`,
    [tenantId, backupType, schedule.retention_days || BACKUP_RETENTION_DAYS, includeTables ? JSON.stringify(includeTables) : null]
  );

  const backupRecord = record.rows[0];

  try {
    const exporter = new TenantDataExporter(tenantId);
    const result = await exporter.exportAll(includeTables);

    await pool.query(
      `UPDATE tenant_backup_records 
       SET status = 'completed',
           data_size = $1,
           table_count = $2,
           record_count = $3,
           backup_data = $4,
           duration_ms = EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000,
           completed_at = NOW()
       WHERE id = $5`,
      [result.dataSize, result.tableCount, result.totalRecords, JSON.stringify(result.tables), backupRecord.id]
    );

    console.log(`[Auto Backup] Tenant ${tenantId}: ${result.tableCount} tables, ${result.totalRecords} records backed up`);
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await pool.query(
      `UPDATE tenant_backup_records SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, backupRecord.id]
    );

    // Alert super admin
    try {
      const tenantInfo = await pool.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
      const tenantName = tenantInfo.rows[0]?.name || tenantId;
      await sendAlertEmail(
        `Backup Failed: ${tenantName}`,
        `Backup failed for tenant ${tenantName}: ${err.message}`,
      );
    } catch (err) {
      captureError(err, 'AutoBackup:EmailAlert');
    }

    throw err;
  }
}

// ── Clean Up Expired Backups ─────────────────────────────────────────────────

async function cleanupExpiredBackups(pool: Pool) {
  // Delete backups past their retention period
  const result = await pool.query(
    `DELETE FROM tenant_backup_records 
     WHERE status = 'completed' 
       AND expires_at < NOW()
     RETURNING id, tenant_id`
  );

  if (result.rows.length > 0) {
    console.log(`[Auto Backup] Cleaned up ${result.rows.length} expired backups`);
  }

  return { cleaned: result.rows.length };
}

// ── Purge Critical Data Backups Past 90 Days ─────────────────────────────────

async function purgeExpiredCriticalBackups(pool: Pool) {
  const result = await pool.query(
    `DELETE FROM critical_data_backups 
     WHERE retained_until < NOW()
     RETURNING id, tenant_id, table_name, record_id`
  );

  if (result.rows.length > 0) {
    console.log(`[Auto Backup] Purged ${result.rows.length} expired critical backups (past 90 days)`);
  }

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
