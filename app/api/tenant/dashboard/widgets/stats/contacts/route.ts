import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies } from '@/drizzle/schema';
import { sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'stats-contacts', 300, async () => {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM ${contacts} WHERE tenant_id = ${tid} AND deleted_at IS NULL) AS count,
        (SELECT COUNT(*)::int FROM ${contacts} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND created_at >= date_trunc('month', now())) AS new_this_month,
        (SELECT COUNT(*)::int FROM ${companies} WHERE tenant_id = ${tid} AND deleted_at IS NULL) AS company_count
    `);
    const row = result.rows?.[0] || {};
    return NextResponse.json({
      data: {
        count: Number(row['count'] ?? 0),
        newThisMonth: Number(row['new_this_month'] ?? 0),
        companyCount: Number(row['company_count'] ?? 0),
      },
    });
  });
}
