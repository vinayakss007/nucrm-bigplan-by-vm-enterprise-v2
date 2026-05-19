import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { activities } from '@/drizzle/schema';
import { users } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');
    const dealId = searchParams.get('deal_id');
    const companyId = searchParams.get('company_id');
    const taskId = searchParams.get('task_id');
    const ticketId = searchParams.get('ticket_id');
    const eventType = searchParams.get('event_type');
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));

    let conditions = [eq(activities.tenantId, ctx.tenantId)];

    if (contactId) {
      conditions.push(eq(activities.entityType, 'contact'));
      conditions.push(eq(activities.entityId, contactId));
    } else if (dealId) {
      conditions.push(eq(activities.entityType, 'deal'));
      conditions.push(eq(activities.entityId, dealId));
    } else if (companyId) {
      conditions.push(eq(activities.entityType, 'company'));
      conditions.push(eq(activities.entityId, companyId));
    } else if (taskId) {
      conditions.push(eq(activities.entityType, 'task'));
      conditions.push(eq(activities.entityId, taskId));
    } else if (ticketId) {
      conditions.push(eq(activities.entityType, 'ticket'));
      conditions.push(eq(activities.entityId, ticketId));
    }

    if (eventType) {
      conditions.push(eq(activities.eventType, eventType));
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(activities)
      .where(and(...conditions));

    const results = await db.select({
      id: activities.id,
      userId: activities.userId,
      entityType: activities.entityType,
      entityId: activities.entityId,
      action: activities.action,
      description: activities.description,
      metadata: activities.metadata,
      createdAt: activities.createdAt,
      userName: users.fullName
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.userId))
    .where(and(...conditions))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .offset(offset);

    return NextResponse.json({
      data: results || [],
      total: countResult?.count ?? 0,
      limit,
      offset,
      hasMore: offset + results.length < (countResult?.count ?? 0),
    });
  } catch (err: any) {
    console.error('[activities GET]', err);
    return NextResponse.json({ data: [], error: err.message }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    if (!body.type || !body.description) {
      return NextResponse.json({ error: 'type and description are required' }, { status: 400 });
    }

    const entity_type = body.deal_id ? 'deal' : (body.contact_id ? 'contact' : 'other');
    const entity_id = body.deal_id || body.contact_id || ctx.userId;

    const [newActivity] = await db.insert(activities)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entityType: entity_type,
        entityId: entity_id,
        action: body.type,
        description: body.description,
        metadata: body.metadata || {}
      } as any)
      .returning();

    return NextResponse.json({ data: newActivity }, { status: 201 });
  } catch (err: any) {
    console.error('[activities POST]', err);
    return apiError(err);
  }
}
