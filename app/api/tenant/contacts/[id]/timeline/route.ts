/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createNoteSchema } from '@/lib/api/schemas';
import { requireAuth, can, type AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { activities, users, contacts } from '@/drizzle/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { parseLimitOffset } from '@/lib/api/query-params';
import { withApiRoute } from '@/lib/api/with-api-route';
import { ownerScope } from '@/lib/api/owner-scope';
import { isEntityId } from '@/lib/id';

/**
 * Can this caller open the contact these entries belong to?
 *
 * `contacts/[id]:82-87` answers 404 for a `sales_rep`
 * (`lib/permissions/definitions.ts:132-137`) reaching a row that is neither
 * `assigned_to` nor `created_by` them, and the trail of a record is read with
 * the record's own rule — the same answer `history/[entity]` (#2712) and the
 * activity feed (#2710) take. It asks no permission: there is no `contacts.view`
 * in the catalogue (#2597), and `contacts.edit` is not a read right.
 */
async function contactVisible(ctx: AuthContext, contactId: string): Promise<boolean> {
  if (!isEntityId(contactId)) return false;
  const [hit] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(
      eq(contacts.id, contactId),
      eq(contacts.tenantId, ctx.tenantId),
      ownerScope(ctx, 'contacts.view_all', contacts),
    ))
    .limit(1);
  return hit !== undefined;
}

/**
 * GET /api/tenant/contacts/[id]/timeline
 * Get contact timeline (activity feed)
 */
export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;
    // The gate this route had was `contacts.view_all || contacts.create`.
    // `create` is not a read right and says nothing about *this* row, and
    // `sales_rep` holds it (`definitions.ts:133`), so every rep passed it and
    // then read by `activities.contact_id = <any uuid>` — including the
    // colleague `user_email` and `user_avatar` the join below selects.
    if (!(await contactVisible(ctx, id))) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const { limit, offset } = parseLimitOffset(searchParams, { defaultLimit: 50, maxLimit: 200 });
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
 
 
  } catch (error) {
    await logError({ error, context: 'tenant/contacts/[id]/timeline GET', requestMethod: 'GET' });
    return apiError(error);
  }
});

/**
 * POST /api/tenant/contacts/[id]/timeline
 * Add activity to contact timeline
 */
export const POST = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const rawBody = await readJsonBody(request);
    const validated = validateBody(createNoteSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const description = v.content;
    const event_type = rawBody.event_type;
    const metadata = rawBody.metadata;

    if (!event_type) {
      return NextResponse.json({ error: 'event_type is required' }, { status: 400 });
    }

    // Verify the caller may open the contact these entries land on. The check
    // here was existence-and-tenant only, so a rep with `contacts.edit` wrote
    // onto a colleague's timeline — the same row rule the read above now asks.
    if (!(await contactVisible(ctx, id))) {
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
 
 
  } catch (error) {
    await logError({ error, context: 'tenant/contacts/[id]/timeline POST', requestMethod: 'POST' });
    return apiError(error);
  }
});
