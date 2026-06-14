import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deadLetterQueue } from '@/drizzle/schema/automation';
import { eq, and, desc, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'));
    const offset = parseInt(searchParams.get('offset') || '0');

    const filters = [eq(deadLetterQueue.tenantId, ctx.tenantId)];
    if (status) filters.push(eq(deadLetterQueue.status, status));

    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(deadLetterQueue)
        .where(and(...filters))
        .orderBy(desc(deadLetterQueue.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(deadLetterQueue)
        .where(and(...filters)),
    ]);

    return NextResponse.json({
      data: items,
      pagination: {
        total: countResult[0]?.count || 0,
        limit,
        offset,
      },
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[dead-letter GET]', err);
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'settings.manage');
    if (deny) return deny;

    const { id, action, resolution } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    if (action === 'retry') {
      const [updated] = await db
        .update(deadLetterQueue)
        .set({
          status: 'pending',
          attempts: 0,
          resolvedAt: null,
        })
        .where(and(
          eq(deadLetterQueue.id, id),
          eq(deadLetterQueue.tenantId, ctx.tenantId)
        ))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      return NextResponse.json({ ok: true, message: 'Job queued for retry' });
    }

    if (action === 'resolve') {
      const [updated] = await db
        .update(deadLetterQueue)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: ctx.userId,
          resolution: resolution || 'Manually resolved',
        })
        .where(and(
          eq(deadLetterQueue.id, id),
          eq(deadLetterQueue.tenantId, ctx.tenantId)
        ))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      return NextResponse.json({ ok: true, message: 'Job resolved' });
    }

    if (action === 'delete') {
      await db
        .delete(deadLetterQueue)
        .where(and(
          eq(deadLetterQueue.id, id),
          eq(deadLetterQueue.tenantId, ctx.tenantId)
        ));

      return NextResponse.json({ ok: true, message: 'Job deleted' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[dead-letter PATCH]', err);
    return apiError(err);
  }
}