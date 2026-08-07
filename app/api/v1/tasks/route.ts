/**
 * GET /api/v1/tasks - List tasks
 * POST /api/v1/tasks - Create task
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tasks, contacts, users } from '@/drizzle/schema';
import { eq, and, sql, desc, count, asc } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/require-auth';
import { limiters } from '@/lib/rate-limit';
import { handleError, ValidationError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rateCheck = await limiters.contacts.check(`tasks:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.reset) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status') || '';
    const priority = searchParams.get('priority') || '';

    const whereClauses = [
      eq(tasks.tenantId, ctx.tenantId),
      sql`${tasks.deletedAt} IS NULL`
    ];

    if (status) {
      whereClauses.push(eq(tasks.completed, status === 'completed'));
    }

    if (priority) {
      whereClauses.push(eq(tasks.priority, priority));
    }

    const [results, totalCount] = await Promise.all([
      db.select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        priority: tasks.priority,
        status: tasks.status,
        completed: tasks.completed,
        due_date: tasks.dueDate,
        created_at: tasks.createdAt,
        assigned_to: tasks.assignedTo,
        // Joined fields
        first_name: contacts.firstName,
        last_name: contacts.lastName,
        assigned_name: users.fullName,
      })
      .from(tasks)
      .leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .leftJoin(users, eq(users.id, tasks.assignedTo))
      .where(and(...whereClauses))
      .orderBy(asc(tasks.dueDate), desc(tasks.createdAt))
      .limit(limit)
      .offset(offset),

      db.select({ total: count() })
        .from(tasks)
        .where(and(eq(tasks.tenantId, ctx.tenantId), sql`${tasks.deletedAt} IS NULL`))
        .then(rows => rows?.[0]?.total ?? 0)
    ]);

    devLogger.request('GET', '/api/v1/tasks', 200, 0, undefined, ctx.userId);

    return NextResponse.json({
      data: results,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: totalCount > offset + limit,
      },
    });
  } catch (error) {
    devLogger.error(error as Error, 'GET /api/v1/tasks');
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rateCheck = await limiters.contacts.check(`tasks:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429 }
      );
    }

    const body = await request.json();

    if (!body.title) {
      throw new ValidationError('title is required');
    }

    const [result] = await db.insert(tasks)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        title: body.title,
        description: body.description || null,
        priority: body.priority || 'medium',
        dueDate: body.due_date ? new Date(body.due_date) : null,
        contactId: body.contact_id || null,
        dealId: body.deal_id || null,
        assignedTo: body.assigned_to || ctx.userId,
        completed: body.completed || false,
        completedAt: body.completed ? new Date() : null,
        status: body.completed ? 'completed' : 'pending',
      })
      .returning();

    if (!result) {
      throw new Error('Failed to create task');
    }

    // Map to snake_case for response
    const responseData = {
      id: result.id,
      title: result.title,
      description: result.description,
      priority: result.priority,
      status: result.status,
      completed: result.completed,
      due_date: result.dueDate,
      created_at: result.createdAt,
    };

    devLogger.request('POST', '/api/v1/tasks', 201, 0, undefined, ctx.userId);

    return NextResponse.json({ data: responseData }, { status: 201 });
  } catch (error) {
    devLogger.error(error as Error, 'POST /api/v1/tasks');
    return handleError(error);
  }
}
