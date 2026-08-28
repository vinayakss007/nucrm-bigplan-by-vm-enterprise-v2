/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateSequenceSchema } from '@/lib/api/schemas';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sequences, sequenceSteps } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';

/**
 * GET /api/tenant/sequences/[id]
 * Get sequence details with steps
 */
export async function GET(
  request: NextRequest,
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequenceId = (await params).id;

    const sequence = await db.query.sequences.findFirst({
      where: and(
        eq(sequences.id, sequenceId),
        eq(sequences.tenantId, ctx.tenantId),
        isNull(sequences.deletedAt)
      ),
      with: {
        steps: {
          orderBy: (steps, { asc }) => [asc(steps.stepNumber)],
        }
      }
    });

    if (!sequence) {
      return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: sequence,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Sequence] GET error:', error);
    return apiError(error);
  }
}

/**
 * PATCH /api/tenant/sequences/[id]
 * Update sequence
 */
export async function PATCH(
  request: NextRequest,
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  { params }: any
) {
  try {
  const limited = await rateLimitMutating(request, 'sequences', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequenceId = (await params).id;
    const body = await readJsonBody(request);
    const validated = validateBody(updateSequenceSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { name, description, status } = v;
    const { steps } = body;

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, sequences, sequenceId, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    // Update sequence
    await db.transaction(async (tx) => {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (status !== undefined) updateData.status = status;
      updateData.updatedAt = new Date();
      updateData.updatedBy = ctx.userId;

      if (Object.keys(updateData).length > 1) {
        await tx.update(sequences)
          .set(updateData)
          .where(and(
            eq(sequences.id, sequenceId),
            eq(sequences.tenantId, ctx.tenantId)
          ));
      }

      // Update steps if provided
      if (steps !== undefined) {
        // Delete existing steps
        await tx.delete(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequenceId));

        // Insert new steps
        if (steps.length > 0) {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stepValues = steps.map((step: any, index: number) => ({
            sequenceId,
            tenantId: ctx.tenantId,
            stepNumber: index + 1,
            stepType: step.type || step.stepType || 'email',
            subject: step.subject || null,
            body: step.body || null,
            delayDays: step.delayDays || step.delay_days || 0,
            delayHours: step.delayHours || step.delay_hours || 0,
            delayMinutes: step.delayMinutes || step.delay_minutes || 0,
            content: step.content || null,
            templateId: step.templateId || step.template_id || null,
            createdBy: ctx.userId,
          }));

          await tx.insert(sequenceSteps).values(stepValues);
        }
      }
    });

    return NextResponse.json({
      ok: true,
      message: 'Sequence updated',
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Sequence] PATCH error:', error);
    return apiError(error);
  }
}

/**
 * DELETE /api/tenant/sequences/[id]
 * Delete sequence (soft delete)
 */
export async function DELETE(
  request: NextRequest,
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  { params }: any
) {
  try {
  const limited = await rateLimitMutating(request, 'sequences', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequenceId = (await params).id;

    await db.update(sequences)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId,
        status: 'archived'
      })
      .where(and(
        eq(sequences.id, sequenceId),
        eq(sequences.tenantId, ctx.tenantId)
      ));

    return NextResponse.json({
      ok: true,
      message: 'Sequence deleted',
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Sequence] DELETE error:', error);
    return apiError(error);
  }
}

/**
 * POST /api/tenant/sequences/[id]/enroll
 * Enroll contacts in sequence
 */
export async function POST(
  request: NextRequest,
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequenceId = (await params).id;
    const body = await readJsonBody(request);
    const { contact_ids } = body;

    if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
      return NextResponse.json({ error: 'contact_ids array is required' }, { status: 400 });
    }

    // Verify sequence exists and is active
    const sequence = await db.query.sequences.findFirst({
      where: and(
        eq(sequences.id, sequenceId),
        eq(sequences.tenantId, ctx.tenantId),
        isNull(sequences.deletedAt)
      )
    });

    if (!sequence) {
      return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
    }

    if (sequence.status !== 'active') {
      return NextResponse.json({ error: 'Sequence must be active to enroll contacts' }, { status: 400 });
    }

    // Enroll each contact using the stored procedure.
    //
    // #1047: previously this awaited one round-trip per contact strictly in
    // sequence (N serial DB round-trips). We run the same per-contact calls
    // concurrently with Promise.allSettled instead, collapsing the latency to
    // roughly a single round-trip while preserving the exact skip-on-error /
    // per-contact result semantics and response shape.
    //
    // A single set-based statement (unnest over the id array) would be even
    // fewer round-trips, but enroll_contact_in_sequence performs a plain
    // INSERT with no ON CONFLICT and sequence_enrollments has no unique
    // constraint (see migration 0032 + 0000_init) — its behavior on a
    // duplicate enrollment cannot be confirmed to be non-raising. If any single
    // call raised inside one set-based statement, the whole batch would abort
    // and lose the resilient skip-on-duplicate behavior. Concurrent per-contact
    // calls keep each enrollment independent (one failure does not poison the
    // rest), so we deliberately choose concurrency over set-based here.
    const enrollments = await Promise.all(
      contact_ids.map(async (contactId) => {
        try {
          const result = await db.execute(sql`
            SELECT public.enroll_contact_in_sequence(
              ${ctx.tenantId}::uuid, 
              ${sequenceId}::uuid, 
              ${contactId}::uuid, 
              ${ctx.userId}::uuid
            ) as enrollment_id
          `);

          const enrollmentId = result.rows[0]?.['enrollment_id'];

          return { contact_id: contactId, enrollment_id: enrollmentId };
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // Skip if already enrolled or other error
          console.error(`Failed to enroll contact ${contactId}:`, error.message);
          return { contact_id: contactId, error: "Internal server error" };
        }
      })
    );

    const enrolled = enrollments.filter(e => 'enrollment_id' in e && e.enrollment_id);

    return NextResponse.json({
      ok: true,
      enrolled: enrolled,
      skipped: enrollments.length - enrolled.length,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Enroll] POST error:', error);
    return apiError(error);
  }
}
