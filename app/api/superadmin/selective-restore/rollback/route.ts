import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { selectiveRestoreLogs, selectiveRestoreAuditLog, superAdminBackups } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { rollbackToSnapshot } from '@/lib/restore/restore-executor';

const schema = z.object({ restore_log_id: z.string().min(1) });

/**
 * POST: Rollback a failed or unwanted restore to pre-restore snapshot
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { restore_log_id } = validated.data;

    const [restoreLog] = await db
      .select({
        id: selectiveRestoreLogs.id,
        tenantId: selectiveRestoreLogs.tenantId,
        backupId: selectiveRestoreLogs.backupId,
        // In original: pre_restore_snapshot_id
      })
      .from(selectiveRestoreLogs)
      .where(eq(selectiveRestoreLogs.id, restore_log_id))
      .limit(1);

    if (!restoreLog) {
      return NextResponse.json({ error: 'Restore log not found' }, { status: 404 });
    }

    // Update status to rolling back
    await db
      .update(selectiveRestoreLogs)
      .set({ status: 'rolling_back' })
      .where(eq(selectiveRestoreLogs.id, restore_log_id));

    const startTime = Date.now();
    try {
      // For now, use db.execute to get pre_restore_snapshot_id if not in schema
      const res = await db.execute(sql`SELECT pre_restore_snapshot_id FROM public.selective_restore_logs WHERE id = ${restore_log_id}`);
      const snapshotId = (res.rows[0] as any)?.pre_restore_snapshot_id;

      if (!snapshotId) {
        throw new Error('No pre-restore snapshot available for rollback');
      }

      await rollbackToSnapshot(snapshotId, restoreLog.tenantId!);

      const durationMs = Date.now() - startTime;

      await db
        .update(selectiveRestoreLogs)
        .set({ 
          status: 'rolled_back',
          completedAt: new Date(),
        })
        .where(eq(selectiveRestoreLogs.id, restore_log_id));

      await db.insert(selectiveRestoreAuditLog).values({
        tenantId: restoreLog.tenantId!,
        action: 'rollback',
        performedBy: ctx.userId,
        performedAt: new Date(),
        oldData: { reason: 'Manual rollback requested' },
      });

      return NextResponse.json({
        success: true,
        message: 'Rollback completed successfully',
        duration_ms: durationMs,
      });

    } catch (err: any) {
      console.error('[rollback]', err);

      await db
        .update(selectiveRestoreLogs)
        .set({ 
          status: 'failed',
          errorMessage: err.message,
        })
        .where(eq(selectiveRestoreLogs.id, restore_log_id));

      return NextResponse.json({
        error: 'Rollback failed',
        details: err.message,
      }, { status: 500 });
    }

  } catch (err: any) {
    console.error('[selective-restore/rollback POST]', err);
    return apiError(err);
  }
}
