/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createSequenceSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { db } from '@/drizzle/db';
import { sequences, sequenceSteps, sequenceEnrollments } from '@/drizzle/schema';
import { eq, and, desc, isNull, getTableColumns, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/tenant/sequences
 * List all sequences
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status') || 'all';

    const filters = [
      eq(sequences.tenantId, ctx.tenantId),
      isNull(sequences.deletedAt)
    ];

    if (statusParam === 'active') {
      filters.push(eq(sequences.status, 'active'));
    } else if (statusParam === 'inactive') {
      filters.push(eq(sequences.status, 'draft'));
    }

    // #3193: `enroll_count` is derived from `sequence_enrollments` here instead of
    // being read off the counter column. The column is a tally of accepted enrollment
    // *calls*: five writers add to it, no path subtracts (`cancelOpenEnrollments` only
    // moves `status`), and a re-enroll of an already-active contact used to add another
    // one on the ON CONFLICT branch. The row count is what the tally was always meant
    // to hold, and it is the shape the other sequences UI already derives for its own
    // "enrolled" figure (`app/tenant/sequences/page.tsx` — that one counts every row of
    // the sequence's `sequence_enrollments`; this pins the tenant and skips tombstones,
    // the same predicate #2740's conflict target uses), so the two surfaces cannot
    // disagree.
    const data = await db.select({
      ...getTableColumns(sequences),
      enrollCount: sql<number>`(
        select count(*)::int from ${sequenceEnrollments}
        where ${sequenceEnrollments.sequenceId} = ${sequences.id}
          and ${sequenceEnrollments.tenantId} = ${ctx.tenantId}
          and ${sequenceEnrollments.deletedAt} is null
      )`,
    })
      .from(sequences)
      .where(and(...filters))
      .orderBy(desc(sequences.createdAt));

    return NextResponse.json({ data });
 
 
  } catch (error) {
    void logError({ error, context: 'tenant/sequences GET' });
    return apiError(error);
  }
});

/**
 * POST /api/tenant/sequences
 * Create new sequence
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'sequences', 'post');
    if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(createSequenceSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { name, description, steps } = v;
    // Honor the caller's status ('draft'|'active'|...); schema defaults to 'draft'
    const status = v.status || 'draft';

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const [newSequence] = await db.transaction(async (tx) => {
      const [seq] = await tx.insert(sequences)
        .values({
          tenantId: ctx.tenantId,
          name: name.trim(),
          description: description || null,
          status,
          createdBy: ctx.userId,
        })
        .returning();

      if (!seq) throw new Error('Failed to create sequence');

      if (steps.length > 0) {
  
        const stepValues = steps.map((step, index) => ({
          sequenceId: seq.id,
          tenantId: ctx.tenantId,
          stepNumber: index + 1,
          stepType: step.type || 'email',
          subject: step.subject || null,
          body: step.body || null,
          delayHours: Math.floor((step.delay_minutes || 0) / 60),
          delayMinutes: (step.delay_minutes || 0) % 60,
          delayDays: 0,
        }));

        await tx.insert(sequenceSteps).values(stepValues);
      }

      return [seq];
    });

    return NextResponse.json({
      ok: true,
      data: newSequence,
    }, { status: 201 });
 
 
  } catch (error) {
    void logError({ error, context: 'tenant/sequences POST' });
    return apiError(error);
  }
});
