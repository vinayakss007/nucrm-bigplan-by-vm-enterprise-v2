/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { backupRecords, backupSchedules, criticalDataBackups, tenants, users } from '@/drizzle/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { createBackup, BackupConfigurationError } from '@/lib/backups/backup-service';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createBackupSchema } from '@/lib/api/schemas';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { setSuperAdminContext } from '@/lib/db/rls';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const list = searchParams.get('list');
    const critical = searchParams.get('critical');

    if (critical === 'true') {
      if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      // PP-031: these reads hit deny-by-default RLS tables whose policy only
      // admits a platform-wide view through app.is_super_admin, which the plain
      // `db` handle never sets.
      await setSuperAdminContext();

      const [deleted, statsRes] = await Promise.all([
        db.select()
          .from(criticalDataBackups)
          .orderBy(desc(criticalDataBackups.backedUpAt))
          .limit(50)
          .catch((err) => { void logError({ error: err, context: 'superadmin/backups critical data query' }); return []; }),

        db.select({
          totalBackups: sql<number>`count(*)::int`,
          restorable: sql<number>`count(*) FILTER (WHERE ${criticalDataBackups.canRestore} = true)::int`,
          deletedRecords: sql<number>`count(*) FILTER (WHERE ${criticalDataBackups.operation} = 'delete')::int`,
          updatedRecords: sql<number>`count(*) FILTER (WHERE ${criticalDataBackups.operation} = 'update')::int`,
        })
        .from(criticalDataBackups)
        .then(rows => rows[0])
        .catch((err) => { void logError({ error: err, context: 'superadmin/backups stats query' }); return { totalBackups: 0, restorable: 0, deletedRecords: 0, updatedRecords: 0 }; }),
      ]);

      // Get table breakdown
      const tableStats = await db
        .select({ 
          tableName: criticalDataBackups.tableName, 
          count: sql<number>`count(*)::int` 
        })
        .from(criticalDataBackups)
        .groupBy(criticalDataBackups.tableName)
        .catch((err) => { void logError({ error: err, context: 'superadmin/backups tableStats query' }); return []; });

 
 
      const stats: {
        totalBackups: number; restorable: number; deletedRecords: number; updatedRecords: number;
        by_table?: { tableName: string; count: number }[];
      } = statsRes || { totalBackups: 0, restorable: 0, deletedRecords: 0, updatedRecords: 0 };
      stats.by_table = tableStats;

      // #1300: standardize on { data }; keep top-level keys for backward compat.
      return NextResponse.json({ data: { deleted, stats }, deleted, stats });
    }

    if (list === 'recent') {
      // The admin view is deliberately platform-wide, so it needs the GUC; the
      // tenant view must NOT get it, or RLS would stop enforcing the very
      // isolation this branch's tenantFilter is there to provide.
      if (ctx.isSuperAdmin) await setSuperAdminContext();

      const tenantFilter = ctx.isSuperAdmin
        ? undefined
        : eq(sql`${backupRecords.metadata}->>'tenant_id'`, ctx.tenantId);

      const backups = await db
        .select({
          id: backupRecords.id,
          backupType: backupRecords.backupType,
          status: backupRecords.status,
          sizeBytes: backupRecords.sizeBytes,
          storagePath: backupRecords.storagePath,
          storageType: backupRecords.storageType,
          durationMs: backupRecords.durationMs,
          createdAt: backupRecords.createdAt,
          completedAt: backupRecords.completedAt,
          expiresAt: backupRecords.expiresAt,
          metadata: backupRecords.metadata,
          initiatedByName: users.fullName,
          tenantName: tenants.name,
        })
        .from(backupRecords)
        .leftJoin(users, eq(users.id, backupRecords.createdBy))
        // PP-031b: `tenants.id = metadata->>'tenant_id'` compared uuid to text and
        // aborted with 42883 (`operator does not exist: uuid = text`) on EVERY
        // request — the error was swallowed below and answered 200 with an empty
        // list. Comparing on the text side keeps a malformed/non-uuid metadata
        // value a non-match instead of a new 22P02.
        .leftJoin(tenants, eq(sql`${tenants.id}::text`, sql`${backupRecords.metadata}->>'tenant_id'`))
        .where(tenantFilter)
        .orderBy(desc(backupRecords.createdAt))
        .limit(50)
        .catch((err) => { void logError({ error: err, context: 'superadmin/backups recent list query' }); return []; });
      
      // #1300: standardize list responses on the { data } envelope. `backups`
      // is retained for backward compatibility with existing consumers during
      // the transition (both point at the same array).
      return NextResponse.json({ data: backups, backups });
    }

    // Default: return schedules (superadmin only)
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // PP-031: backup_schedules has the same super-admin branch, so the Schedules
    // tab listed zero rows even where schedules exist.
    await setSuperAdminContext();

    const schedules = await db
      .select({
        id: backupSchedules.id,
        tenantId: backupSchedules.tenantId,
        scheduleType: backupSchedules.scheduleType,
        backupType: backupSchedules.backupType,
        retentionDays: backupSchedules.retentionDays,
        enabled: backupSchedules.enabled,
        lastRunAt: backupSchedules.lastRunAt,
        nextRunAt: backupSchedules.nextRunAt,
        createdAt: backupSchedules.createdAt,
        tenantName: tenants.name,
      })
      .from(backupSchedules)
      .leftJoin(tenants, eq(tenants.id, backupSchedules.tenantId))
      .orderBy(desc(backupSchedules.createdAt))
      .catch((err) => { void logError({ error: err, context: 'superadmin/backups schedules query' }); return []; });

    // #1300: standardize on { data }; keep `schedules` for backward compat.
    return NextResponse.json({ data: schedules, schedules });
 
 
  } catch (err) { 
    await logError({ error: err, context: 'superadmin/backups GET', requestMethod: 'GET' });
    return apiError(err); 
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // PP-031: both halves of the tenant_isolation policy (USING and WITH CHECK)
    // carry the super-admin branch, so the metadata write below matched nothing
    // without it — the tenant_id the admin passed was silently dropped.
    await setSuperAdminContext();

    let body;
    try { body = await readJsonBody(request); } catch (err) { void logError({ error: err, context: 'superadmin/backups POST JSON parse', level: 'warning' }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const parsed = validateBody(createBackupSchema, body);
    if (parsed instanceof NextResponse) return parsed;

    // Handle restore action from frontend
    if (parsed.data.action === 'restore' && parsed.data.backupId) {
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const capture = new CriticalDataCapture();
      const result = await capture.restoreFromBackup(parsed.data.backupId);

      await logSuperAdminAction({
        adminId: ctx.userId,
        adminEmail: ctx.user?.email || "",
        action: 'restore.executed',
        metadata: { backupId: parsed.data.backupId, via: 'backup-route' },
      });

      return NextResponse.json(result);
    }

    const backup = await createBackup({
      backupType: parsed.data.backup_type,
      initiatedBy: ctx.userId,
      initiatedAuto: false,
    });

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'backup.created',
      metadata: { backupType: parsed.data.backup_type, tenantId: parsed.data.tenant_id },
    });

    // If tenant_id was provided, update the record
    if (parsed.data.tenant_id) {
      await db
        .update(backupRecords)
        .set({ 
          metadata: { ...((backup as { metadata?: Record<string, unknown> }).metadata || {}), tenant_id: parsed.data.tenant_id } 
        })
        .where(eq(backupRecords.id, backup.id));
    }

    return NextResponse.json({ data: backup }, { status: 201 });
 
 
  } catch (err) { 
    await logError({ error: err, context: 'superadmin/backups POST', requestMethod: 'POST' });
    // "Internal server error" sent the operator to the server logs for a
    // refusal whose whole message is a config fix (no BYPASSRLS dump role, no
    // DATABASE_URL). This route is super-admin-only, so naming it is safe and
    // 503 says "retrying is pointless until the deployment changes".
    if (err instanceof BackupConfigurationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return apiError(err); 
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // PP-031: the concurrency guard's read and the UPDATE both key off
    // backup_schedules, so without the platform context every edit answered
    // "Schedule not found" for a schedule that exists.
    await setSuperAdminContext();

    const body = await readJsonBody(request);
    const { id, enabled, schedule_type, retention_days } = body as {
      id?: string;
      enabled?: boolean;
      schedule_type?: string;
      retention_days?: number;
    };

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const guardResult = await concurrencyGuard(db, backupSchedules, id, undefined, body.expectedUpdatedAt);
    if (guardResult) return guardResult;

    const updates: Record<string, unknown> = {};
    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (schedule_type) updates.scheduleType = schedule_type;
    if (typeof retention_days === 'number' && retention_days > 0) updates.retentionDays = retention_days;

    const [updated] = await db
      .update(backupSchedules)
      .set(updates)
      .where(eq(backupSchedules.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

    return NextResponse.json({ ok: true, data: updated });
 
 
  } catch (err) {
    return apiError(err);
  }
});
