import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { updateContactSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, sequences, sequenceSteps, sequenceEnrollments } from '@/drizzle/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function POST(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;
    
    const rawBody = await req.json();
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

    // Verify sequence belongs to this tenant
    const seq = await db.query.sequences.findFirst({
      where: and(
        eq(sequences.id, sequence_id),
        eq(sequences.tenantId, ctx.tenantId),
        eq(sequences.status, 'active')
      ),
      columns: { id: true }
    });
    if (!seq) return NextResponse.json({ error: 'Sequence not found or inactive' }, { status: 404 });

    // Fetch sequence steps
    const steps = await db.query.sequenceSteps.findMany({
        limit: 200,
      where: and(
        eq(sequenceSteps.sequenceId, sequence_id),
        eq(sequenceSteps.isActive, true)
      ),
      orderBy: [asc(sequenceSteps.stepNumber)]
    });

    const firstDelay = steps[0]?.delayDays ?? 0;
    const nextStepAt = new Date(Date.now() + firstDelay * 86400000);

    // Upsert enrollment
    const [enrollment] = await db.insert(sequenceEnrollments)
      .values({
        tenantId: ctx.tenantId,
        sequenceId: sequence_id,
        contactId: contactId,
        currentStep: 1, // Drizzle schema default was 1, legacy was 0
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

    // Increment enroll count
    await db.update(sequences)
      .set({ enrollCount: sql`${sequences.enrollCount} + 1` })
      .where(eq(sequences.id, sequence_id))
      .catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ data: enrollment }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const rawDelBody = await req.json();
    const delValidated = validateBody(updateContactSchema, rawDelBody);
    if (delValidated instanceof NextResponse) return delValidated;
    const { sequence_id } = rawDelBody;
    if (!sequence_id) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 });

    const contactId = (await params).id;

    await db.update(sequenceEnrollments)
      .set({ 
        status: 'cancelled',
        updatedAt: new Date()
      })
      .where(and(
        eq(sequenceEnrollments.contactId, contactId),
        eq(sequenceEnrollments.sequenceId, sequence_id),
        eq(sequenceEnrollments.tenantId, ctx.tenantId)
      ));

    return NextResponse.json({ ok: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}
