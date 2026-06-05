import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tasks } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'stats-tasks', 120, async () => {
    const today = new Date().toISOString().split('T')[0];

    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM ${tasks}
         WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status != 'completed'
         AND due_date = ${today}::date) AS due_today,
        (SELECT COUNT(*)::int FROM ${tasks}
         WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status != 'completed'
         AND due_date < ${today}::date) AS overdue,
        (SELECT COUNT(*)::int FROM ${tasks}
         WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status != 'completed') AS total_open
    `);
    const row = result.rows?.[0] || {};

    return NextResponse.json({
      data: {
        dueToday: Number(row['due_today'] ?? 0),
        overdue: Number(row['overdue'] ?? 0),
        totalOpen: Number(row['total_open'] ?? 0),
      },
    });
  });
}
