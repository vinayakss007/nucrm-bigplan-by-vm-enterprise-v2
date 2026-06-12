import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { backupRecords, backupSchedules, criticalDataBackups, tenants, users } from '@/drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createBackup } from '@/lib/backups/backup-service';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const list = searchParams.get('list');
    const critical = searchParams.get('critical');

    if (critical === 'true') {
      const [deleted, statsRes] = await Promise.all([
        db.select()
          .from(criticalDataBackups)
          .orderBy(desc(criticalDataBackups.backedUpAt))
          .limit(50)
          .catch(() => []),

        db.select({
          totalBackups: sql<number>`count(*)::int`,
          restorable: sql<number>`count(*) FILTER (WHERE ${criticalDataBackups.canRestore} = true)::int`,
          deletedRecords: sql<number>`count(*) FILTER (WHERE ${criticalDataBackups.operation} = 'delete')::int`,
          updatedRecords: sql<number>`count(*) FILTER (WHERE ${criticalDataBackups.operation} = 'update')::int`,
        })
        .from(criticalDataBackups)
        .then(rows => rows[0])
        .catch(() => ({ totalBackups: 0, restorable: 0, deletedRecords: 0, updatedRecords: 0 })),
      ]);

      // Get table breakdown
      const tableStats = await db
        .select({ 
          tableName: criticalDataBackups.tableName, 
          count: sql<number>`count(*)::int` 
        })
        .from(criticalDataBackups)
        .groupBy(criticalDataBackups.tableName)
        .catch(() => []);

      const stats: any = statsRes || { totalBackups: 0, restorable: 0, deletedRecords: 0, updatedRecords: 0 };
      stats.by_table = tableStats;

      return NextResponse.json({ deleted, stats });
    }

    if (list === 'recent') {
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
        .leftJoin(tenants, eq(tenants.id, sql`${backupRecords.metadata}->>'tenant_id'`))
        .orderBy(desc(backupRecords.createdAt))
        .limit(50)
        .catch(() => []);
      
      return NextResponse.json({ backups });
    }

    // Default: return schedules
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
      .catch(() => []);

    return NextResponse.json({ schedules });
  } catch (err: any) { 
    console.error('[superadmin/backups GET]', err);
    return apiError(err); 
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json().catch(e => { console.error('[json] parse error:', e); return {}; });

    // Handle restore action from frontend
    if (body.action === 'restore' && body.backupId) {
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const capture = new CriticalDataCapture();
      const result = await capture.restoreFromBackup(body.backupId);
      return NextResponse.json(result);
    }

    const { backup_type = 'full', tenant_id } = body;

    const backup = await createBackup({
      backupType: backup_type as 'full' | 'schema' | 'selective',
      initiatedBy: ctx.userId,
      initiatedAuto: false,
    });

    // If tenant_id was provided, update the record
    if (tenant_id) {
      await db
        .update(backupRecords)
        .set({ 
          metadata: { ...(((backup as any).metadata) || {}), tenant_id } 
        })
        .where(eq(backupRecords.id, backup.id));
    }

    return NextResponse.json({ data: backup }, { status: 201 });
  } catch (err: any) { 
    console.error('[superadmin/backups POST]', err);
    return apiError(err); 
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return apiError(err);
  }
}
