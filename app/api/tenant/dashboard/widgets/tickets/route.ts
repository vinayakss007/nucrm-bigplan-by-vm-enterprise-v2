import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { supportTickets } from '@/drizzle/schema';
import { sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'widget-tickets', 120, async () => {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM ${supportTickets} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status = 'open') AS open,
        (SELECT COUNT(*)::int FROM ${supportTickets} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status = 'in_progress') AS in_progress,
        (SELECT COUNT(*)::int FROM ${supportTickets} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status = 'resolved') AS resolved,
        (SELECT COUNT(*)::int FROM ${supportTickets} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND priority = 'urgent') AS urgent,
        (SELECT COUNT(*)::int FROM ${supportTickets} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND created_at >= CURRENT_DATE) AS new_today
    `);
    const row = result.rows?.[0] || {};
    return NextResponse.json({
      data: {
        open: Number(row['open'] ?? 0),
        inProgress: Number(row['in_progress'] ?? 0),
        resolved: Number(row['resolved'] ?? 0),
        urgent: Number(row['urgent'] ?? 0),
        newToday: Number(row['new_today'] ?? 0),
      },
    });
  });
}
