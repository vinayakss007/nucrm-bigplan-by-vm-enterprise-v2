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
import { contacts, sequences, sequenceSteps, sequenceEnrollments } from '@/drizzle/schema';
import { eq, and, sql, isNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { uuidIdSchema } from '@/lib/validation/uuid';
import { ownerScope } from '@/lib/api/owner-scope';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { cancelOpenEnrollments, firstStepDueAt } from '@/lib/cron/sequence-steps';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * #2737 — the same ceiling `contacts/bulk` puts on an id list (`MAX_BULK`): this
 * used to be N serial round-trips, which hid how large a batch could be.
 */
const MAX_ENROLL = 500;

const enrollContactsSchema = z.object({
  contact_ids: z.array(uuidIdSchema).min(1, 'contact_ids array is required').max(MAX_ENROLL, `Max ${MAX_ENROLL} contacts per enrollment`),
});

/**
 * GET /api/tenant/sequences/[id]
 * Get sequence details with steps
 */
export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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
 
 
  } catch (error) {
    await logError({ error: error, context: 'Sequence GET error', requestMethod: 'GET' });
    return apiError(error);
  }
});

/**
 * PATCH /api/tenant/sequences/[id]
 * Update sequence
 */
/**
 * #2794 — the step shape the PATCH accepts. It used to be a hand-written union of
 * every spelling every client had ever used (`stepType`, `delay_days`, `content`),
 * which is exactly how the unvalidated body leaked into the table. It now mirrors
 * `createSequenceSchema`'s item, and is read off `validated.data`.
 */
interface SequenceStepInput {
  type?: string;
  subject?: string | null;
  body?: string | null;
  delay_minutes?: number;
  template_id?: string | null;
}

export const PATCH = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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
    // #2794: `steps` came off the raw body while the rest came off `validated.data`,
    // so the array never passed the schema. The route then read a dozen keys the
    // schema does not declare — `delay_days`, `stepType`, `content` — straight into
    // `sequence_steps`. The enum on `type` is enforced by
    // `chk_sequence_steps_step_type` (`drizzle/migrations/0050_data_validation_checks.sql:121`)
    // at insert time, so an unenforced value surfaced as a 400 from a 23514 rather
    // than a validation error, and an over-long `body` or a non-integer delay was
    // stored as-is. Read it from the validated data.
    const { steps } = v;

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, sequences, sequenceId, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    // Update sequence
    await db.transaction(async (tx) => {
 
 
      const updateData: Partial<typeof sequences.$inferInsert> = {};
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
          const stepValues = steps.map((step: SequenceStepInput, index: number) => ({
            sequenceId,
            tenantId: ctx.tenantId,
            stepNumber: index + 1,
            stepType: step.type ?? 'email',
            subject: step.subject || null,
            body: step.body || null,
            // POST (`sequences/route.ts:107-109`) splits `delay_minutes` into the
            // three columns and the cron sums them back with `stepDelayMs()`
            // (`lib/cron/sequence-steps.ts:63`); do the same here so the two write
            // paths land a step on the same date.
            delayHours: Math.floor((step.delay_minutes ?? 0) / 60),
            delayMinutes: (step.delay_minutes ?? 0) % 60,
            delayDays: 0,
            content: null,
            templateId: step.template_id || null,
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
 
 
  } catch (error) {
    await logError({ error: error, context: 'Sequence PATCH error', requestMethod: 'PATCH' });
    return apiError(error);
  }
});

/**
 * DELETE /api/tenant/sequences/[id]
 * Delete sequence (soft delete)
 */
export const DELETE = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'sequences', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequenceId = (await params).id;

    // #2392: the tombstone and the enrollment cancel must commit together.
    // A bare UPDATE leaves every `sequence_enrollments` row at status
    // 'active', and the cron sweep filtered on nothing but that status, so a
    // deleted sequence kept mailing its contacts until each step ran out.
    const cancelledEnrollments = await db.transaction(async (tx) => {
      await tx.update(sequences)
        .set({
          deletedAt: new Date(),
          deletedBy: ctx.userId,
          updatedAt: new Date(),
          status: 'archived'
        })
        .where(and(
          eq(sequences.id, sequenceId),
          eq(sequences.tenantId, ctx.tenantId)
        ));

      return cancelOpenEnrollments(tx, ctx.tenantId, { sequenceId });
    });

    return NextResponse.json({
      ok: true,
      cancelledEnrollments,
      message: 'Sequence deleted',
    });
 
 
  } catch (error) {
    await logError({ error: error, context: 'Sequence DELETE error', requestMethod: 'DELETE' });
    return apiError(error);
  }
});

/**
 * POST /api/tenant/sequences/[id]/enroll
 * Enroll contacts in sequence
 */
export const POST = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequenceId = (await params).id;
    const raw = await readJsonBody(request);
    const parsed = validateBody(enrollContactsSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    // A repeated id in one request would otherwise be enrolled once and counted
    // twice against `skipped`, so the batch is deduped before it is resolved.
    const requestedIds = [...new Set(parsed.data.contact_ids)];

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

    // #2737 — this used to call `public.enroll_contact_in_sequence(…)` with four
    // uuid arguments, and the function is defined with two
    // (`drizzle/migrations/0032_missing_db_functions.sql:50-59`). Postgres resolves
    // by name AND argument list, so every call raised "function does not exist";
    // each one was caught, logged, turned into `{ contact_id, error }`, dropped by
    // the `enrolled` filter below, and answered as **200** with
    // `enrolled: []` and the whole batch hidden inside `skipped`. Even the 2-arg
    // form cannot work: its INSERT omits `tenant_id`, which is NOT NULL
    // (`drizzle/schema/marketing.ts:81`).
    //
    // So the row is written here, the way `contacts/bulk:419-434` and
    // `segments/[id]/enroll` already do it, and a failure surfaces as a 500 instead
    // of an empty success.
    //
    // Resolve the requested ids against contacts this caller may act on. #1120
    // compliance first (never enrol an opt-out), then the record-level rule:
    // `contacts/[id]:82-87` answers 404 to a caller who lacks `contacts.view_all`
    // and owns neither `assigned_to` nor `created_by`, so an id list assembled
    // anywhere else must not enrol those rows either — same narrowing #2699 put on
    // `notes/bulk` and #2732 on segment enroll.
    const eligible = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(
        inArray(contacts.id, requestedIds),
        eq(contacts.tenantId, ctx.tenantId),
        isNull(contacts.deletedAt),
        eq(contacts.doNotContact, false),
        eq(contacts.unsubscribed, false),
        ownerScope(ctx, 'contacts.view_all', contacts)
      ));
    const eligibleIds = eligible.map((r) => r.id);
    const skippedOptedOut = requestedIds.length - eligibleIds.length;

    if (eligibleIds.length === 0) {
      return NextResponse.json({ error: 'No enrollable contacts found' }, { status: 404 });
    }

    // Contacts already active in this sequence. Migration 0130 (#2740) added the partial unique
    // index `sequence_enrollments_seq_contact_active_unique` on (sequence_id, contact_id), so a
    // duplicate insert is now rejected outright — but this read is still the dedupe that matters
    // here: it is what produces `skipped_existing`, and it keeps the batch a no-conflict insert
    // instead of a 23505 that aborts the whole transaction.
    const active = await db
      .select({ contactId: sequenceEnrollments.contactId })
      .from(sequenceEnrollments)
      .where(and(
        eq(sequenceEnrollments.tenantId, ctx.tenantId),
        eq(sequenceEnrollments.sequenceId, sequenceId),
        eq(sequenceEnrollments.status, 'active'),
        inArray(sequenceEnrollments.contactId, eligibleIds)
      ));
    const activeSet = new Set(active.map((a) => a.contactId));
    const toEnroll = eligibleIds.filter((id) => !activeSet.has(id));

    if (toEnroll.length === 0) {
      return NextResponse.json({
        ok: true,
        enrolled: [],
        skipped: requestedIds.length,
        skipped_opted_out: skippedOptedOut,
        skipped_existing: activeSet.size,
      });
    }

    const inserted = await db.transaction(async (tx) => {
      // #2793: `next_step_at` has no default and the sweep requires
      // `next_step_at <= NOW()`, so a row written without it is active and never
      // sends. Computed once for the batch, from this sequence's own step 1.
      const nextStepAt = await firstStepDueAt(tx, ctx.tenantId, sequenceId);
      const rows = await tx.insert(sequenceEnrollments).values(
        toEnroll.map((contactId) => ({
          tenantId: ctx.tenantId,
          sequenceId,
          contactId,
          status: 'active' as const,
          currentStep: 1,
          nextStepAt,
          enrolledBy: ctx.userId,
        }))
      // #2740: migration 0130's partial unique index is the belt to the read above. A concurrent
      // duplicate is now rejected rather than written, and `returning()` reports only the rows
      // actually inserted — so `rows.length`, the response and the enroll_count delta all stay
      // honest while the request that lost the race still succeeds.
      ).onConflictDoNothing()
       .returning({ id: sequenceEnrollments.id, contactId: sequenceEnrollments.contactId });

      await tx.update(sequences)
        .set({ enrollCount: sql`COALESCE(${sequences.enrollCount}, 0) + ${rows.length}` })
        .where(eq(sequences.id, sequenceId));

      return rows;
    });

    return NextResponse.json({
      ok: true,
      enrolled: inserted.map((r) => ({ contact_id: r.contactId, enrollment_id: r.id })),
      skipped: requestedIds.length - inserted.length,
      skipped_opted_out: skippedOptedOut,
      skipped_existing: activeSet.size,
    });
 
 
  } catch (error) {
    await logError({ error: error, context: 'Enroll POST error', requestMethod: 'POST' });
    return apiError(error);
  }
});
