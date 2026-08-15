import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { backupRecords, backupSchedules } from '@/drizzle/schema';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * GET /api/system/backup-status
 * Returns backup health information — last backup, next scheduled, totals.
 * Protected: superadmin only.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Get latest backup
    const [latest] = await db
      .select()
      .from(backupRecords)
      .orderBy(desc(backupRecords.createdAt))
      .limit(1);

    // Get total count
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(backupRecords);
    const totalCount = countRow?.count ?? 0;

    // Get active schedules
    const schedules = await db
      .select()
      .from(backupSchedules)
      .where(eq(backupSchedules.enabled, true));

    // Compute health
    const lastBackupAt = latest?.createdAt ?? null;
    const ageHours = lastBackupAt
      ? (Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60)
      : Infinity;

    const healthy = lastBackupAt !== null && ageHours < 25; // backup ran in last 25 hours

    return NextResponse.json({
      data: {
        healthy,
        last_backup: latest ? {
          id: latest.id,
          status: latest.status,
          created_at: latest.createdAt,
          size_bytes: latest.sizeBytes ?? null,
        } : null,
        age_hours: Math.round(ageHours * 10) / 10,
        total_backups: totalCount,
        active_schedules: schedules.length,
        next_scheduled: schedules[0]?.nextRunAt ?? null,
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
