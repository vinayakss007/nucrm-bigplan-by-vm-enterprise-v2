/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateContactSchema } from '@/lib/api/schemas';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, contactLifecycleHistory, users } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { ownerScope } from '@/lib/api/owner-scope';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * POST /api/tenant/contacts/[id]/lifecycle
 * Update contact lifecycle stage
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
    const validated = validateBody(updateContactSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const _v = validated.data;
    const lifecycle_stage = rawBody.lifecycle_stage;
    const reason = rawBody.reason;

    const validStages = [
      'subscriber',
      'lead',
      'marketing_qualified',
      'sales_qualified',
      'opportunity',
      'customer',
      'evangelist',
      'churned',
    ];

    if (!lifecycle_stage || !validStages.includes(lifecycle_stage)) {
      return NextResponse.json({ 
        error: `Invalid stage. Must be one of: ${validStages.join(', ')}` 
      }, { status: 400 });
    }

    // Verify contact exists
    //
    // #2752 — `contacts.edit` says the caller may re-stage a contact; it does not say
    // which ones. Resolve by the same rule `contacts/[id]` answers with
    // (app/api/tenant/contacts/[id]/route.ts:196-199), so a caller without
    // `contacts.view_all` gets the 404 here that they already get on the read, instead
    // of a write to a row they cannot open. `ownerScope` is `undefined` for a
    // `view_all` holder, which `and()` skips, so their predicate is unchanged.
    const contact = await db.query.contacts.findFirst({
      where: and(
        eq(contacts.id, id),
        eq(contacts.tenantId, ctx.tenantId),
        isNull(contacts.deletedAt),
        ownerScope(ctx, 'contacts.view_all', contacts),
      )
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const oldStage = contact.lifecycleStage;

    // #2755 — `SELECT public.update_contact_lifecycle(...)` could not ever have worked.
    // The function (drizzle/migrations/0032_missing_db_functions.sql:231-240) inserts
    // its history row into `contact_lifecycle_events`, a table no migration creates —
    // the real one is `contact_lifecycle_history` (drizzle/schema/crm.ts:691, which the
    // GET two screens below reads) — so the call raised
    // `relation "contact_lifecycle_events" does not exist`, and because that aborts the
    // whole function the `UPDATE` above it rolled back with it: the stage never changed
    // and the route answered 500. Measured by applying `0000_init.sql` plus `0032` to a
    // scratch cluster and calling the function. Its second statement is wrong even once
    // the table exists: it re-reads `lifecycle_stage` *after* the update, so every
    // history row records `from_stage = to_stage` — which is what a hand-created table
    // showed, `customer|customer` for a lead moved to customer. `oldStage` is the value
    // the existence read above returned, taken before anything is written.
    //
    // The write is therefore this route's own, in one transaction, the way
    // `contacts/merge` does it (app/api/tenant/contacts/merge/route.ts:73,176). Both
    // tables isolate on `app.current_tenant` (`0031_rls_remaining_tables.sql:30,177-181`)
    // and `db` pins that per request, so nothing here needs a session GUC of its own.
    await db.transaction(async (tx) => {
      await tx.update(contacts)
        .set({ lifecycleStage: lifecycle_stage, updatedAt: new Date() })
        .where(and(
          eq(contacts.id, id),
          eq(contacts.tenantId, ctx.tenantId),
          isNull(contacts.deletedAt),
        ));

      await tx.insert(contactLifecycleHistory).values({
        tenantId: ctx.tenantId,
        contactId: id,
        fromStage: oldStage,
        toStage: lifecycle_stage,
        changedBy: ctx.userId,
        reason: typeof reason === 'string' ? reason : null,
      });
    });

    return NextResponse.json({
      ok: true,
      data: {
        contact_id: id,
        from_stage: oldStage,
        to_stage: lifecycle_stage,
      },
      message: `Lifecycle updated from "${oldStage}" to "${lifecycle_stage}"`,
    });
 
 
  } catch (error) {
    await logError({ error, context: 'tenant/contacts/[id]/lifecycle POST', requestMethod: 'POST' });
    return apiError(error);
  }
});

/**
 * GET /api/tenant/contacts/[id]/lifecycle
 * Get contact lifecycle history
 */
export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;

    const history = await db.select({
      id: contactLifecycleHistory.id,
      tenantId: contactLifecycleHistory.tenantId,
      contactId: contactLifecycleHistory.contactId,
      oldStage: contactLifecycleHistory.fromStage,
      newStage: contactLifecycleHistory.toStage,
      reason: contactLifecycleHistory.reason,
      changedBy: contactLifecycleHistory.changedBy,
      changedAt: contactLifecycleHistory.changedAt,
      changed_by_name: users.fullName,
      changed_by_email: users.email
    })
    .from(contactLifecycleHistory)
    .leftJoin(users, eq(users.id, contactLifecycleHistory.changedBy))
    .where(and(eq(contactLifecycleHistory.contactId, id), eq(contactLifecycleHistory.tenantId, ctx.tenantId)))
    .orderBy(desc(contactLifecycleHistory.changedAt))
    .limit(50);

    return NextResponse.json({
      data: history,
    });
 
 
  } catch (error) {
    await logError({ error, context: 'tenant/contacts/[id]/lifecycle GET', requestMethod: 'GET' });
    return apiError(error);
  }
});
