/**
 * GET /api/v1/tasks/[id] - Get task by ID
 * PUT /api/v1/tasks/[id] - Update task
 * DELETE /api/v1/tasks/[id] - Delete task
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tasks, contacts, users } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/require-auth';
import { handleError, NotFoundError, ValidationError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';

export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [task] = await db.select({
      id: tasks.id,
      tenant_id: tasks.tenantId,
      title: tasks.title,
      description: tasks.description,
      priority: tasks.priority,
      status: tasks.status,
      due_date: tasks.dueDate,
      completed: tasks.completed,
      completed_at: tasks.completedAt,
      contact_id: tasks.contactId,
      deal_id: tasks.dealId,
      assigned_to: tasks.assignedTo,
      created_at: tasks.createdAt,
      updated_at: tasks.updatedAt,
      // Joined fields
      first_name: contacts.firstName,
      last_name: contacts.lastName,
      assigned_name: users.fullName,
    })
    .from(tasks)
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(and(
      eq(tasks.id, id),
      eq(tasks.tenantId, ctx.tenantId),
      sql`${tasks.deletedAt} IS NULL`
    ))
    .limit(1);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    return NextResponse.json({ data: task });
  } catch (error) {
    devLogger.error(error as Error, 'GET /api/v1/tasks/[id]');
    return handleError(error);
  }
}

export async function PUT(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;
    const body = await request.json();
    const updateFields: any = {};

    if (body.title !== undefined) updateFields.title = body.title;
    if (body.description !== undefined) updateFields.description = body.description;
    if (body.priority !== undefined) updateFields.priority = body.priority;
    if (body.due_date !== undefined) updateFields.dueDate = body.due_date;
    if (body.contact_id !== undefined) updateFields.contactId = body.contact_id;
    if (body.deal_id !== undefined) updateFields.dealId = body.deal_id;
    if (body.assigned_to !== undefined) updateFields.assignedTo = body.assigned_to;
    if (body.completed !== undefined) {
      updateFields.completed = body.completed;
      if (body.completed) {
        updateFields.completedAt = new Date();
        updateFields.status = 'completed';
      } else {
        updateFields.completedAt = null;
        updateFields.status = 'pending';
      }
    }

    if (Object.keys(updateFields).length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    const [result] = await db.update(tasks)
      .set({
        ...updateFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(
        eq(tasks.id, id),
        eq(tasks.tenantId, ctx.tenantId),
        sql`${tasks.deletedAt} IS NULL`
      ))
      .returning();

    if (!result) {
      throw new NotFoundError('Task not found');
    }

    // Map to snake_case for response
    const responseData = {
      id: result.id,
      title: result.title,
      description: result.description,
      priority: result.priority,
      status: result.status,
      due_date: result.dueDate,
      completed: result.completed,
      completed_at: result.completedAt,
      contact_id: result.contactId,
      deal_id: result.dealId,
      assigned_to: result.assignedTo,
      updated_at: result.updatedAt,
    };

    devLogger.request('PUT', '/api/v1/tasks/[id]', 200, 0, undefined, ctx.userId);

    return NextResponse.json({ data: responseData });
  } catch (error) {
    devLogger.error(error as Error, 'PUT /api/v1/tasks/[id]');
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [deleted] = await db.update(tasks)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId
      })
      .where(and(
        eq(tasks.id, id),
        eq(tasks.tenantId, ctx.tenantId),
        sql`${tasks.deletedAt} IS NULL`
      ))
      .returning({ id: tasks.id });

    if (!deleted) {
      throw new NotFoundError('Task not found');
    }

    devLogger.request('DELETE', '/api/v1/tasks/[id]', 200, 0, undefined, ctx.userId);

    return NextResponse.json({ ok: true, message: 'Task deleted' });
  } catch (error) {
    devLogger.error(error as Error, 'DELETE /api/v1/tasks/[id]');
    return handleError(error);
  }
}
