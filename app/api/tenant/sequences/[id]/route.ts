import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sequences, sequenceSteps } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';

/**
 * GET /api/tenant/sequences/[id]
 * Get sequence details with steps
 */
export async function GET(
  request: NextRequest,
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
  } catch (error: any) {
    console.error('[Sequence] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/tenant/sequences/[id]
 * Update sequence
 */
export async function PATCH(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequenceId = (await params).id;
    const body = await request.json();
    const { name, description, status, steps } = body;

    // Update sequence
    await db.transaction(async (tx) => {
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
  } catch (error: any) {
    console.error('[Sequence] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/tenant/sequences/[id]
 * Delete sequence (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: any
) {
  try {
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
  } catch (error: any) {
    console.error('[Sequence] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/sequences/[id]/enroll
 * Enroll contacts in sequence
 */
export async function POST(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequenceId = (await params).id;
    const body = await request.json();
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

    // Enroll each contact using the stored procedure
    const enrollments = [];
    for (const contactId of contact_ids) {
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
        
        enrollments.push({ 
          contact_id: contactId, 
          enrollment_id: enrollmentId 
        });
      } catch (error: any) {
        // Skip if already enrolled or other error
        console.error(`Failed to enroll contact ${contactId}:`, error.message);
        enrollments.push({ contact_id: contactId, error: error.message });
      }
    }

    const enrolled = enrollments.filter(e => e.enrollment_id);

    return NextResponse.json({
      ok: true,
      enrolled: enrolled,
      skipped: enrollments.length - enrolled.length,
    });
  } catch (error: any) {
    console.error('[Enroll] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
