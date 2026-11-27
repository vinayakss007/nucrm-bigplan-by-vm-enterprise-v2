/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { notifications } from '@/drizzle/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { concurrencyGuard, checkStaleUpdate } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { publishUnreadCount } from '@/lib/realtime/publish';
import { withApiRoute } from '@/lib/api/with-api-route';
import { parseLimitOffset } from '@/lib/api/query-params';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const { limit, offset } = parseLimitOffset(searchParams, { defaultLimit: 20, maxLimit: 100 });
    const unreadOnly = searchParams.get('unread') === 'true';

    const filters = [
      eq(notifications.tenantId, ctx.tenantId),
      eq(notifications.userId, ctx.userId),
      isNull(notifications.deletedAt),
    ];

    if (unreadOnly) {
      filters.push(isNull(notifications.readAt));
    }

    // Perf: count + page + unread badge in parallel (was 3 serial round-trips).
    const [countResult, data, unreadCount, allCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(...filters)).then((r) => r[0]),
      db.select()
        .from(notifications)
        .where(and(...filters))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId),
          isNull(notifications.deletedAt),
          isNull(notifications.readAt),
        )).then((r) => r[0]),
      // #3754: a stable tenant-wide total for the header, unaffected by the
      // unread filter the page now sends.
      db.select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId),
          isNull(notifications.deletedAt),
        )).then((r) => r[0]),
    ]);

    return NextResponse.json({
      data,
      total: countResult?.count ?? 0,
      totalAll: allCount?.count ?? 0,
      unread: unreadCount?.count ?? 0,
      limit,
      offset,
      hasMore: offset + data.length < (countResult?.count ?? 0),
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'notifications', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(request);

    if (body.action === 'mark_all_read' || body.markAllRead === true) {
      const marked = await db.update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId),
          isNull(notifications.deletedAt),
          isNull(notifications.readAt),
        ))
        .returning({ id: notifications.id });

      // Only broadcast "zero unread" when this request actually changed rows.
      // A lost tenant context used to match nothing yet publish 0 to every
      // device, clearing badges for notifications still unread in the DB.
      if (marked.length > 0) {
        void publishUnreadCount(ctx.tenantId, ctx.userId, 0);
      }
      return NextResponse.json({ success: true, updated: marked.length });
    }

    if (body.id) {
      const concurrencyWhere = concurrencyGuard(notifications, body.expectedUpdatedAt);
      const whereConditions = [
        eq(notifications.id, body.id),
        eq(notifications.userId, ctx.userId),
      ];
      if (concurrencyWhere) whereConditions.push(concurrencyWhere);

      const [updated] = await db.update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(and(...whereConditions))
        .returning();

      const stale = checkStaleUpdate(updated);
      if (stale) return stale;

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
 
 
  } catch (err) {
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'notifications', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    let body;
    try { body = await readJsonBody(request); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    if (body.id) {
      const concurrencyWhere = concurrencyGuard(notifications, body.expectedUpdatedAt);
      const whereConditions = [
        eq(notifications.id, body.id),
        eq(notifications.userId, ctx.userId),
      ];
      if (concurrencyWhere) whereConditions.push(concurrencyWhere);

      const [updated] = await db.update(notifications)
        .set({ deletedAt: new Date() })
        .where(and(...whereConditions))
        .returning();

      const stale = checkStaleUpdate(updated);
      if (stale) return stale;
    } else {
      const removed = await db.update(notifications)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId),
          isNull(notifications.deletedAt),
        ))
        .returning({ id: notifications.id });

      if (removed.length > 0) {
        void publishUnreadCount(ctx.tenantId, ctx.userId, 0);
      }
      return NextResponse.json({ success: true, deleted: removed.length });
    }

    return NextResponse.json({ success: true });
 
 
  } catch (err) {
    return apiError(err);
  }
});
