import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tasks } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const id = (await params).id;
    const body = await req.json();

    if (body.title !== undefined && !body.title?.trim())
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.description !== undefined) updateData.description = body.description;
    if (body.due_date !== undefined) updateData.dueDate = body.due_date ? new Date(body.due_date) : null;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.contact_id !== undefined) updateData.contactId = body.contact_id;
    if (body.deal_id !== undefined) updateData.dealId = body.deal_id;
    if (body.assigned_to !== undefined) updateData.assignedTo = body.assigned_to;
    if (body.status !== undefined) updateData.status = body.status;
    
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

    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (err: any) { 
    console.error('[task DELETE]', err);
    return apiError(err); 
  }
}
