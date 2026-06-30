import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { updateFollowUpSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { followUps } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const id = (await params).id;
    const body = await req.json();
    const validated = validateBody(updateFollowUpSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (v.title !== undefined) updateData.title = v.title;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.due_date !== undefined) updateData.dueDate = v.due_date ? new Date(v.due_date) : null;
    if (v.status !== undefined) updateData.status = v.status;
    if (v.lead_id !== undefined) updateData.leadId = v.lead_id;
    if (v.contact_id !== undefined) updateData.contactId = v.contact_id;
    if (v.deal_id !== undefined) updateData.dealId = v.deal_id;
    if (v.assigned_to !== undefined) updateData.assignedTo = v.assigned_to;
    if (v.auto_ai_enabled !== undefined) updateData.autoAiEnabled = v.auto_ai_enabled;

    if (v.status === 'completed') {
      updateData.completedAt = new Date();
      updateData.missedDays = 0;
    }

    const [row] = await db.update(followUps)
      .set(updateData)
      .where(and(
        eq(followUps.id, id),
        eq(followUps.tenantId, ctx.tenantId),
        isNull(followUps.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[follow-up PATCH]', err);
    return apiError(err);
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const id = (await params).id;

    const [row] = await db.update(followUps)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
      })
      .where(and(
        eq(followUps.id, id),
        eq(followUps.tenantId, ctx.tenantId),
        isNull(followUps.deletedAt)
      ))
      .returning({ id: followUps.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true, message: 'Follow-up deleted.' });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[follow-up DELETE]', err);
    return apiError(err);
  }
}
