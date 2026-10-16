/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tasks } from '@/drizzle/schema';
import { sql } from 'drizzle-orm';
import { ownerScope, ownerScopeSql, ownerCacheKey } from '@/lib/api/owner-scope';
import { withCache } from '@/lib/dashboard/widget-cache';
import { logError, tenantMeta } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    // `ctx` is a `let`, so the narrowing the guard above establishes does not
    // survive into the withCache closure (#2688).
    const auth = ctx;

    return withCache(tid, 'stats-tasks', 120, async () => {
      const today = new Date().toISOString().split('T')[0];
      // Raw template, so the scope is spliced as text: `and()` would skip an
      // undefined argument, a template has nothing to skip (#2688).
      const mine = ownerScopeSql(ownerScope(auth, 'tasks.view_all', tasks));

      const result = await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM ${tasks}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status != 'completed'
           ${mine} AND due_date = ${today}::date) AS due_today,
          (SELECT COUNT(*)::int FROM ${tasks}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status != 'completed'
           ${mine} AND due_date < ${today}::date) AS overdue,
          (SELECT COUNT(*)::int FROM ${tasks}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status != 'completed'${mine}) AS total_open
      `);
      const row = result.rows?.[0] || {};

      return NextResponse.json({
        data: {
          dueToday: Number(row['due_today'] ?? 0),
          overdue: Number(row['overdue'] ?? 0),
          totalOpen: Number(row['total_open'] ?? 0),
        },
      });
    }, ownerCacheKey(auth, 'tasks.view_all'));
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/stats/tasks', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
