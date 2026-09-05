/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { notifications } from '@/drizzle/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';
import { logError, tenantMeta } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;
    const uid = ctx.userId;

    return withCache(tid, 'notifications-list', 60, async () => {
      // Single round-trip: items + unread count as scalar subselect
      // (previously two serial queries).
      const rows = await db
        .select({
          id: notifications.id,
          title: notifications.title,
          body: notifications.body,
          type: notifications.type,
          link: notifications.link,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
          unreadCount: sql<number>`(SELECT count(*)::int FROM ${notifications} n WHERE n.tenant_id = ${tid} AND n.user_id = ${uid} AND n.deleted_at IS NULL AND n.read_at IS NULL)`,
        })
        .from(notifications)
        .where(and(
          eq(notifications.tenantId, tid),
          eq(notifications.userId, uid),
          isNull(notifications.deletedAt),
        ))
        .orderBy(desc(notifications.createdAt))
        .limit(5);

      const first = rows[0];
      const unreadCount = first?.unreadCount ?? 0;
      const items = rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        type: r.type,
        link: r.link,
        readAt: r.readAt,
        createdAt: r.createdAt,
      }));

      return NextResponse.json({
        data: {
          items,
          stats: {
            unreadCount,
            totalCount: unreadCount,
          },
        },
      });
    });
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/notifications', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
