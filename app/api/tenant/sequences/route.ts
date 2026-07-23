import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createSequenceSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sequences, sequenceSteps } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';

/**
 * GET /api/tenant/sequences
 * List all sequences
 */
export async function GET(request: NextRequest) {
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

    const data = await db.select()
      .from(sequences)
      .where(and(...filters))
      .orderBy(desc(sequences.createdAt));

    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[sequences GET]', error);
    return apiError(error);
  }
}

/**
 * POST /api/tenant/sequences
 * Create new sequence
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;

    const rawBody = await request.json();
    const validated = validateBody(createSequenceSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { name, description, steps } = v;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Create sequence with steps in transaction
    const newSequence = await db.transaction(async (tx) => {
      const [seq] = await tx.insert(sequences)
        .values({
          tenantId: ctx.tenantId,
          name: name.trim(),
          description: description || null,
          status: 'active',
          createdBy: ctx.userId,
        })
        .returning();

      if (steps.length > 0) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stepValues = steps.map((step: any, index: number) => ({
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

      return seq;
    });

    return NextResponse.json({
      ok: true,
      data: newSequence,
    }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[sequences POST]', error);
    return apiError(error);
  }
}
