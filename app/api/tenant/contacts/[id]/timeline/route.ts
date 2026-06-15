import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createNoteSchema } from '@/lib/api/schemas';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { activities, users, contacts } from '@/drizzle/schema';
import { eq, and, desc, count } from 'drizzle-orm';

/**
 * GET /api/tenant/contacts/[id]/timeline
 * Get contact timeline (activity feed)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all') && !can(ctx, 'contacts.create')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const eventType = searchParams.get('event_type');

    // Build filters
    const filters = [
      eq(activities.contactId, id),
      eq(activities.tenantId, ctx.tenantId)
    ];
    
    if (eventType) {
      filters.push(eq(activities.eventType, eventType));
    }

    const activityList = await db.select({
      id: activities.id,
      event_type: activities.eventType,
      description: activities.description,
      metadata: activities.metadata,
      created_at: activities.createdAt,
      user_name: users.fullName,
      user_email: users.email,
      user_avatar: users.avatarUrl
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.userId))
    .where(and(...filters))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .offset(offset);

    // Get total count
    const totalResult = await db.select({ total: count() })
      .from(activities)
      .where(and(...filters));

    return NextResponse.json({
      data: activityList,
      total: totalResult[0]?.total ?? 0,
      limit,
      offset,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Timeline] GET error:', error);
    return apiError(error);
  }
}

/**
 * POST /api/tenant/contacts/[id]/timeline
 * Add activity to contact timeline
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const rawBody = await request.json();
    const validated = validateBody(createNoteSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const description = v.content;
    const event_type = rawBody.event_type;
    const metadata = rawBody.metadata;

    if (!event_type) {
      return NextResponse.json({ error: 'event_type is required' }, { status: 400 });
    }

    // Verify contact exists and belongs to tenant
    const contact = await db.query.contacts.findFirst({
      where: and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId))
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Create activity
    const [newActivity] = await db.insert(activities)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        contactId: id,
        eventType: event_type,
        description,
        metadata: metadata || {},
      } as typeof activities.$inferInsert)
      .returning();

    return NextResponse.json({
      ok: true,
      data: newActivity,
    }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Timeline] POST error:', error);
    return apiError(error);
  }
}
