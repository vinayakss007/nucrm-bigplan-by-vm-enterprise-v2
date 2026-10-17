/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createNoteSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { activities, users, contacts } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { processMentions } from '@/lib/notifications';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { ownerScope } from '@/lib/api/owner-scope';
import { isEntityId } from '@/lib/id';
import type { AuthContext } from '@/lib/auth/middleware';

/**
 * The trail of a record is read with the record's own rule: `contacts/[id]:82-87`
 * answers 404 for a `sales_rep` (`lib/permissions/definitions.ts:132-137`)
 * reaching a row that is neither `assigned_to` nor `created_by` them, and this
 * says the same thing before a note is returned (#2724 — the POST and DELETE in
 * this file both asked; the GET asked nothing).
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

export const GET = withApiRoute(async (request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { id } = await params;

    if (!(await contactVisible(ctx, id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const data = await db.select({
      id: activities.id,
      tenantId: activities.tenantId,
      userId: activities.userId,
      contactId: activities.contactId,
      type: activities.eventType,
      description: activities.description,
      metadata: activities.metadata,
      createdAt: activities.createdAt,
      full_name: users.fullName,
      avatar_url: users.avatarUrl
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.userId))
    .where(and(eq(activities.contactId, id), eq(activities.tenantId, ctx.tenantId)))
    .orderBy(desc(activities.createdAt))
    .limit(50);

    return NextResponse.json({ data });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});

export const POST = withApiRoute(async (request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // The GET and PATCH handlers in this file both ask for contacts.edit; the
    // POST — which writes the row's updatedAt — asked for nothing (#2698).
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const { id } = await params;

    // #2698 — the activity insert below lands on a row the caller may not be
    // allowed to touch. Pre-read the owners as contacts/[id]:304-316 does.
    if (!can(ctx, 'contacts.view_all')) {
      const [row] = await db
        .select({ assignedTo: contacts.assignedTo, createdBy: contacts.createdBy })
        .from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)))
        .limit(1);

      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (row.assignedTo !== ctx.userId && row.createdBy !== ctx.userId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }
    const rawBody = await readJsonBody(request);
    const validated = validateBody(createNoteSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const description = v.content;
    const type = v.type;
    const metadata = {};
    
    if (!description?.trim()) {
      return NextResponse.json({ error: 'description required' }, { status: 400 });
    }
    
    const VALID = ['note', 'call', 'email', 'meeting', 'task', 'deal_update'];
    if (!VALID.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${VALID.join(', ')}` }, { status: 400 });
    }

    const [row] = await db.transaction(async (tx) => {
      const [r] = await tx.insert(activities)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          entityType: 'contact',
          entityId: id,
          contactId: id,
          eventType: type,
          description: description.trim(),
          metadata: metadata || {},
        })
        .returning();

      await tx.update(contacts)
        .set({ updatedAt: new Date() })
        .where(and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)));

      return [r];
    });

    // Process mentions for notifications
    await processMentions(description.trim(), ctx.tenantId, ctx.userId, `/tenant/contacts/${id}`);

    return NextResponse.json({ data: row }, { status: 201 });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});

export const DELETE = withApiRoute(async (request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'contacts', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const { id } = await params;
    const { noteId } = await readJsonBody(request);

    if (!noteId) {
      return NextResponse.json({ error: 'noteId required' }, { status: 400 });
    }

    await db.update(activities)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(activities.id, noteId),
        eq(activities.userId, ctx.userId),
        eq(activities.contactId, id),
        eq(activities.tenantId, ctx.tenantId),
        isNull(activities.deletedAt)
      ));

    return NextResponse.json({ ok: true });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});
