/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tasks } from '@/drizzle/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { ownerScope, ownerCacheKey } from '@/lib/api/owner-scope';
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

    return withCache(tid, 'tasks-list', 120, async () => {
      const items = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          dueDate: tasks.dueDate,
          priority: tasks.priority,
          status: tasks.status,
          completed: tasks.completed,
        })
        .from(tasks)
        .where(and(
          eq(tasks.tenantId, tid),
          isNull(tasks.deletedAt),
          eq(tasks.status, 'pending'),
          // #2688 — the tasks list narrows to the caller's own rows without
          // tasks.view_all (app/api/tenant/tasks/route.ts:38-40). This widget
          // handed out another rep's task titles and cached them per tenant.
          ownerScope(auth, 'tasks.view_all', tasks),
        ))
        .orderBy(asc(tasks.dueDate))
        .limit(10);

      return NextResponse.json({ data: { items } });
    }, ownerCacheKey(auth, 'tasks.view_all'));
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/tasks', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
