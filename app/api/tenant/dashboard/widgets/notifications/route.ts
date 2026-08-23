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

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;
  const uid = ctx.userId;

  return withCache(tid, 'notifications-list', 60, async () => {
    const notifs = await db
      .select({
        id: notifications.id,
        title: notifications.title,
        body: notifications.body,
        type: notifications.type,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(
        eq(notifications.tenantId, tid),
        eq(notifications.userId, uid),
        isNull(notifications.deletedAt),
      ))
      .orderBy(desc(notifications.createdAt))
      .limit(5);

    const [unreadResult] = await db.select({
      count: sql<number>`count(*)::int`,
    })
      .from(notifications)
      .where(and(
        eq(notifications.tenantId, tid),
        eq(notifications.userId, uid),
        isNull(notifications.deletedAt),
        isNull(notifications.readAt),
      ));

    const unreadCount = unreadResult?.count ?? 0;

    return NextResponse.json({
      data: {
        items: notifs,
        stats: {
          unreadCount,
          totalCount: unreadCount,
        },
      },
    });
  });
}
