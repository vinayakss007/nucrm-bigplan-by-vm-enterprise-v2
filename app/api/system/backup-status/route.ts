/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { truncateForStore } from '@/lib/error-redaction';
import { db } from '@/drizzle/db';
import { backupAlerts, backupRecords, backupSchedules } from '@/drizzle/schema';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/system/backup-status
 * The operator/monitor read path for disaster-recovery readiness: the last backup
 * that can actually be restored, the last one that failed, when the next run is,
 * and how many backup alerts are open and unresolved. Superadmin only.
 *
 * #2600 — this used to answer "healthy" from the NEWEST `backup_records` row
 * whatever its status, so a dump that failed an hour after a success reported the
 * platform as backed up, and the failure itself was returned as `last_backup`.
 * Measured on the live database 2026-10-13: newest row `status='failed'`
 * (`pg_dump role "nucrm" is neither superuser nor BYPASSRLS`), and 19 rows in
 * `backup_alerts` with `resolved = false` — a table nothing could read, because
 * this endpoint did not query it and the only page the alert email links
 * (`/superadmin/backups`) does not either.
 */

/** A completed backup older than this is stale — one missed nightly run plus slack. */
const HEALTH_WINDOW_HOURS = 25;

/**
 * `backup_records.error_message` is written through `truncateForStore`, so it is
 * already parameter-redacted; the excerpt is a length cap for the response, not a
 * security control.
 */
const FAILURE_EXCERPT_CHARS = 300;

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // The newest COMPLETED backup — `healthy` has to mean restorable, so a
    // failed or pending row can never supply the green light. `idx_backup_records_status`
    // is on (status, completed_at), so this is the indexed path.
    const [lastCompleted] = await db
      .select({
        id: backupRecords.id,
        backupType: backupRecords.backupType,
        completedAt: backupRecords.completedAt,
        sizeBytes: backupRecords.sizeBytes,
        storageType: backupRecords.storageType,
        lastVerifiedAt: backupRecords.lastVerifiedAt,
        verifiedOk: backupRecords.verifiedOk,
      })
      .from(backupRecords)
      .where(and(eq(backupRecords.status, 'completed'), sql`${backupRecords.completedAt} IS NOT NULL`))
      .orderBy(desc(backupRecords.completedAt))
      .limit(1);

    const [lastFailure] = await db
      .select({
        id: backupRecords.id,
        backupType: backupRecords.backupType,
        status: backupRecords.status,
        createdAt: backupRecords.createdAt,
        errorMessage: backupRecords.errorMessage,
      })
      .from(backupRecords)
      .where(eq(backupRecords.status, 'failed'))
      .orderBy(desc(backupRecords.createdAt))
      .limit(1);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(backupRecords);
    const totalCount = countRow?.count ?? 0;

    // `deleted_at` is the deletion signal for this table (#2393 — the tenant FK
    // cascade never fires, because a deleted tenant is a tombstone UPDATE), so an
    // enabled-but-tombstoned schedule is not an active one. ASC defaults to NULLS
    // LAST, which makes schedules[0] the soonest pending run.
    const schedules = await db
      .select({
        id: backupSchedules.id,
        tenantId: backupSchedules.tenantId,
        scheduleType: backupSchedules.scheduleType,
        nextRunAt: backupSchedules.nextRunAt,
      })
      .from(backupSchedules)
      .where(and(eq(backupSchedules.enabled, true), isNull(backupSchedules.deletedAt)))
      .orderBy(asc(backupSchedules.nextRunAt));

    // The alert trail gets its first reader here (#2600): unresolved rows are the
    // operator's only durable record of a backup problem, and until now no GET
    // surface returned them. backup_alerts carries `backup_alerts_read_all`
    // (SELECT qual `true`), so this read is not RLS-blind the way the other two
    // tables are for a tenant-less context.
    const alertRows = await db
      .select({
        alertType: backupAlerts.alertType,
        count: sql<number>`count(*)::int`,
        oldest: sql<Date>`min(${backupAlerts.createdAt})`,
      })
      .from(backupAlerts)
      .where(eq(backupAlerts.resolved, false))
      .groupBy(backupAlerts.alertType);

    const openAlertCount = alertRows.reduce((sum, row) => sum + row.count, 0);
    const oldestUnresolved = alertRows
      .map((row) => row.oldest)
      .filter((when): when is Date => when !== null && when !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    const lastBackupAt = lastCompleted?.completedAt ?? null;
    const ageHours = lastBackupAt
      ? (Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60)
      : Infinity;

    return NextResponse.json({
      data: {
        healthy: lastBackupAt !== null && ageHours < HEALTH_WINDOW_HOURS,
        last_backup: lastCompleted ? {
          id: lastCompleted.id,
          status: 'completed',
          backup_type: lastCompleted.backupType,
          created_at: lastCompleted.completedAt,
          size_bytes: lastCompleted.sizeBytes ?? null,
          storage_type: lastCompleted.storageType ?? null,
          last_verified_at: lastCompleted.lastVerifiedAt ?? null,
          verified_ok: lastCompleted.verifiedOk ?? null,
        } : null,
        last_failure: lastFailure ? {
          id: lastFailure.id,
          status: lastFailure.status,
          backup_type: lastFailure.backupType,
          created_at: lastFailure.createdAt,
          error_excerpt: lastFailure.errorMessage
            ? truncateForStore(lastFailure.errorMessage, FAILURE_EXCERPT_CHARS)
            : null,
        } : null,
        age_hours: Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null,
        total_backups: totalCount,
        active_schedules: schedules.length,
        next_scheduled: schedules.find((s) => s.nextRunAt)?.nextRunAt ?? null,
        open_alerts: {
          count: openAlertCount,
          oldest_unresolved_at: oldestUnresolved,
          by_type: alertRows
            .map((row) => ({ alert_type: row.alertType, count: row.count }))
            .sort((a, b) => b.count - a.count),
        },
      },
    });
  } catch (err) {
    return apiError(err);
  }
});
