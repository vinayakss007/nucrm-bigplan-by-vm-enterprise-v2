import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads } from '@/drizzle/schema';
import { eq, and, isNull, gte, sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'widget-leads', 300, async () => {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM ${leads} WHERE tenant_id = ${tid} AND deleted_at IS NULL) AS total,
        (SELECT COUNT(*)::int FROM ${leads} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND lead_status = 'new') AS new,
        (SELECT COUNT(*)::int FROM ${leads} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND lead_status = 'contacted') AS contacted,
        (SELECT COUNT(*)::int FROM ${leads} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND lead_status = 'qualified') AS qualified,
        (SELECT COUNT(*)::int FROM ${leads} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND lead_status = 'converted') AS converted,
        (SELECT COUNT(*)::int FROM ${leads} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND created_at >= date_trunc('month', now())) AS new_this_month
    `);
    const row = result.rows?.[0] || {};
    return NextResponse.json({
      data: {
        total: Number(row['total'] ?? 0),
        new: Number(row['new'] ?? 0),
        contacted: Number(row['contacted'] ?? 0),
        qualified: Number(row['qualified'] ?? 0),
        converted: Number(row['converted'] ?? 0),
        newThisMonth: Number(row['new_this_month'] ?? 0),
      },
    });
  });
}
