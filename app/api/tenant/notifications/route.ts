import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { notifications } from '@/drizzle/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));
    const unreadOnly = searchParams.get('unread') === 'true';

    const filters = [
      eq(notifications.tenantId, ctx.tenantId),
      eq(notifications.userId, ctx.userId),
      isNull(notifications.deletedAt),
    ];

    if (unreadOnly) {
      filters.push(isNull(notifications.readAt));
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(...filters));

    const data = await db.select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    const unreadCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.tenantId, ctx.tenantId),
        eq(notifications.userId, ctx.userId),
        isNull(notifications.deletedAt),
        isNull(notifications.readAt),
      ));

    return NextResponse.json({
      data,
      total: countResult?.count ?? 0,
      unread: unreadCount[0]?.count ?? 0,
      limit,
      offset,
      hasMore: offset + data.length < (countResult?.count ?? 0),
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();

    if (body.action === 'mark_all_read' || body.markAllRead === true) {
      await db.update(notifications)
        .set({ readAt: new Date() })
        .where(and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId),
          isNull(notifications.readAt),
        ));
      return NextResponse.json({ success: true });
    }

    if (body.id) {
      await db.update(notifications)
        .set({ readAt: new Date() })
        .where(and(
          eq(notifications.id, body.id),
          eq(notifications.userId, ctx.userId),
        ));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    if (body.id) {
      await db.update(notifications)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(notifications.id, body.id),
          eq(notifications.userId, ctx.userId),
        ));
    } else {
      await db.update(notifications)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId),
        ));
    }

    return NextResponse.json({ success: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
