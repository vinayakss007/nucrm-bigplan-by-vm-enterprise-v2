import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { updateTaskSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { tasks } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors';

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const id = (await params).id;
    const body = await req.json();
    const validated = validateBody(updateTaskSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (v.title !== undefined) updateData.title = v.title;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.due_date !== undefined) updateData.dueDate = v.due_date ? new Date(v.due_date) : null;
    if (v.priority !== undefined) updateData.priority = v.priority;
    if (v.contact_id !== undefined) updateData.contactId = v.contact_id;
    if (v.deal_id !== undefined) updateData.dealId = v.deal_id;
    if (v.assigned_to !== undefined) updateData.assignedTo = v.assigned_to;
    if (v.status !== undefined) updateData.status = v.status;
    
    if (body.completed === true) {
      updateData.status = 'completed';
      updateData.completedAt = new Date();
    } else if (body.completed === false) {
      updateData.status = 'pending';
      updateData.completedAt = null;
    }

    const [row] = await db.update(tasks)
      .set(updateData)
      .where(and(
        eq(tasks.id, id),
        eq(tasks.tenantId, ctx.tenantId),
        isNull(tasks.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (body.completed === true) {
      await logAudit({ 
        tenantId: ctx.tenantId, 
        userId: ctx.userId, 
        action: 'complete', 
        entityType: 'task', 
        entityId: id 
      });
      fireWebhooks(ctx.tenantId, 'task.completed', { id }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    }

    return NextResponse.json({ data: row });
  } catch (err: any) { 
    console.error('[task PATCH]', err);
    return apiError(err); 
  }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'tasks.delete');
    if (deny) return deny;

    const id = (await params).id;

    const [row] = await db.update(tasks)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId 
      })
      .where(and(
        eq(tasks.id, id),
        eq(tasks.tenantId, ctx.tenantId),
        isNull(tasks.deletedAt)
      ))
      .returning({ id: tasks.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    fireWebhooks(ctx.tenantId, 'task.deleted', { id }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (err: any) { 
    console.error('[task DELETE]', err);
    return apiError(err); 
  }
}
