/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deadLetterQueue } from '@/drizzle/schema/automation';
import { eq, and, desc, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuardById } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
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
  } catch (err: any) {
    void logError({ error: err, context: 'tenant/jobs/dead-letter GET' });
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'workflows', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'settings.manage');
    if (deny) return deny;

    const { id, action, resolution, expectedUpdatedAt } = await readJsonBody(request);

    if (!id) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    const conflict = await concurrencyGuardById(db, deadLetterQueue, id, expectedUpdatedAt);
    if (conflict) return conflict;

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
  } catch (err: any) {
    void logError({ error: err, context: 'tenant/jobs/dead-letter PATCH' });
    return apiError(err);
  }
});