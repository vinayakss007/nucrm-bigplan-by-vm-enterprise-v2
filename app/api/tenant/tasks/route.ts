import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { createTaskSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tasks, contacts, deals, users, tenants, plans, activities } from '@/drizzle/schema';
import { eq, and, or, sql, desc, asc, gte, lte, isNull } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';
import { createNotification } from '@/lib/notifications';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(500, parseInt(searchParams.get('limit') ?? '100'));
    const offset = parseInt(searchParams.get('offset') ?? '0');
    const dueStart = searchParams.get('due_start');
    const dueEnd = searchParams.get('due_end');

    const filters = [
      eq(tasks.tenantId, ctx.tenantId),
      isNull(tasks.deletedAt)
    ];

    if (!can(ctx, 'tasks.view_all')) {
      filters.push(or(eq(tasks.assignedTo, ctx.userId), eq(tasks.createdBy, ctx.userId))!);
    }

    if (dueStart) filters.push(gte(tasks.dueDate, new Date(dueStart)));
    if (dueEnd)   filters.push(lte(tasks.dueDate, new Date(dueEnd)));

    const [countRes] = await db.select({ 
      count: sql<number>`count(*)::int` 
    })
    .from(tasks)
    .where(and(...filters));

    const data = await db.select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      priority: tasks.priority,
      status: tasks.status,
      dueDate: tasks.dueDate,
      completedAt: tasks.completedAt,
      contactId: tasks.contactId,
      dealId: tasks.dealId,
      assignedTo: tasks.assignedTo,
      createdAt: tasks.createdAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      dealTitle: deals.title,
      assigneeName: users.fullName
    })
    .from(tasks)
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(and(...filters))
    .orderBy(asc(tasks.dueDate), desc(tasks.createdAt))
    .limit(limit)
    .offset(offset);

    return NextResponse.json({ data, total: countRes?.count ?? 0 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[tasks GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'tasks.create');
    if (deny) return deny;

    const limited = await checkRateLimit(request, { action: 'tasks_create', max: 100, windowMinutes: 60 });
    if (limited) return limited;

    const body = await request.json();
    const validated = validateBody(createTaskSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Enforce plan task limit
    const [tenantWithPlan] = await db.select({
      features: plans.features
    })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, ctx.tenantId));

    const features = tenantWithPlan?.features as Record<string, unknown> | null;
    const maxTasks = (features?.max_tasks ?? 0) as number;
    
    if (maxTasks > 0) {
      const [taskCount] = await db.select({ 
        count: sql<number>`count(*)::int` 
      })
      .from(tasks)
      .where(and(eq(tasks.tenantId, ctx.tenantId), isNull(tasks.deletedAt)));

      if ((taskCount?.count ?? 0) >= maxTasks) {
        return NextResponse.json({
          error: `Task limit reached (${maxTasks}). Upgrade your plan to create more tasks.`,
        }, { status: 403 });
      }
    }

    const [newTask] = await db.insert(tasks)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        title: v.title,
        description: v.description,
        dueDate: v.due_date ? new Date(v.due_date) : null,
        priority: v.priority,
        contactId: v.contact_id || null,
        dealId: v.deal_id || null,
        assignedTo: v.assigned_to || ctx.userId,
        status: v.status,
        completedAt: v.status === 'completed' ? new Date() : null,
      })
      .returning();

    if (!newTask) throw new Error('Failed to create task');

    // Activity log
    await db.insert(activities)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        contactId: v.contact_id || null,
        dealId: v.deal_id || null,
        entityType: 'task',
        entityId: newTask.id,
        eventType: 'task_created',
        action: 'create',
        description: `Created task: ${v.title}`,
      })
      .catch(err => console.error('[tasks POST] activity log failed:', err));

    if (v.assigned_to && v.assigned_to !== ctx.userId) {
      createNotification({
        userId: v.assigned_to,
        tenantId: ctx.tenantId,
        type: 'task_assigned',
        title: `Task assigned: ${v.title}`,
        body: v.description?.slice(0, 150) ?? '',
        entity_type: 'task',
        link: `/tenant/tasks`,
      }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    }

    fireWebhooks(ctx.tenantId, 'task.created', { id: newTask.id, title: v.title }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ data: newTask }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[tasks POST]', err);
    return apiError(err);
  }
}
