/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateContactSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, sequences, sequenceSteps, sequenceEnrollments } from '@/drizzle/schema';
import { eq, and, asc, sql, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { cancelOpenEnrollments } from '@/lib/cron/sequence-steps';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;
    
    const rawBody = await readJsonBody(req);
    const validated = validateBody(updateContactSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { sequence_id } = rawBody;
    if (!sequence_id) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 });

    const contactId = (await params).id;

    // Verify contact belongs to this tenant
    const contact = await db.query.contacts.findFirst({
      where: and(
        eq(contacts.id, contactId),
        eq(contacts.tenantId, ctx.tenantId),
        sql`${contacts.deletedAt} IS NULL`
      ),
      columns: { id: true }
    });
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    // Verify sequence belongs to this tenant and is still live (#2392: a
    // tombstoned sequence must not accept new enrollments either)
    const seq = await db.query.sequences.findFirst({
      where: and(
        eq(sequences.id, sequence_id),
        eq(sequences.tenantId, ctx.tenantId),
        eq(sequences.status, 'active'),
        isNull(sequences.deletedAt)
      ),
      columns: { id: true }
    });
    if (!seq) return NextResponse.json({ error: 'Sequence not found or inactive' }, { status: 404 });

    // Fetch sequence steps
    const steps = await db.query.sequenceSteps.findMany({
        limit: 200,
      where: and(
        eq(sequenceSteps.sequenceId, sequence_id),
        eq(sequenceSteps.isActive, true),
        isNull(sequenceSteps.deletedAt)
      ),
      orderBy: [asc(sequenceSteps.stepNumber)]
    });

    const firstDelay = steps[0]?.delayDays ?? 0;
    const nextStepAt = new Date(Date.now() + firstDelay * 86400000);

    // Upsert enrollment + increment enroll count atomically
    const [enrollment] = await db.transaction(async (tx) => {
      const [e] = await tx.insert(sequenceEnrollments)
        .values({
          tenantId: ctx.tenantId,
          sequenceId: sequence_id,
          contactId: contactId,
          currentStep: 1,
          status: 'active',
          nextStepAt: nextStepAt,
          enrolledAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [sequenceEnrollments.sequenceId, sequenceEnrollments.contactId],
          set: {
            status: 'active',
            currentStep: 1,
            nextStepAt: nextStepAt,
            enrolledAt: new Date(),
            updatedAt: new Date(),
          }
        })
        .returning();

      await tx.update(sequences)
        .set({ enrollCount: sql`${sequences.enrollCount} + 1` })
        .where(eq(sequences.id, sequence_id));

      return [e];
    });

    return NextResponse.json({ data: enrollment }, { status: 201 });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});

export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'contacts', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const rawDelBody = await readJsonBody(req);
    const delValidated = validateBody(updateContactSchema, rawDelBody);
    if (delValidated instanceof NextResponse) return delValidated;
    const { sequence_id } = rawDelBody;
    if (!sequence_id) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 });

    const contactId = (await params).id;

    // #2392: cancel the open enrollment and the step logs waiting on it, scoped
    // to status 'active' so finished history is never rewritten to 'cancelled'.
    const cancelledEnrollments = await db.transaction((tx) => cancelOpenEnrollments(
      tx,
      ctx.tenantId,
      { contactId, sequenceId: sequence_id },
    ));

    return NextResponse.json({ ok: true, cancelledEnrollments });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});
