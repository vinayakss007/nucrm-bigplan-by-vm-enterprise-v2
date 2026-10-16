/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateContactSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, activities } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

const STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'];

export const PATCH = withApiRoute(async (request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'contacts', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;
    
    const { id } = await params;
    const rawBody = await readJsonBody(request);
    const validated = validateBody(updateContactSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const lead_status = v.lead_status ?? rawBody.lead_status;
    const reason = rawBody.reason;
    
    if (!STATUSES.includes(lead_status)) {
      return NextResponse.json({ 
        error: `lead_status must be: ${STATUSES.join(', ')}` 
      }, { status: 400 });
    }

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = rawBody.expectedUpdatedAt ? new Date(rawBody.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, contacts, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const prev = await db.query.contacts.findFirst({
      // The two owner columns ride along on a read the route already performs,
      // so the rule below can be stated the way contacts/[id]:195 states it.
      columns: { leadStatus: true, assignedTo: true, createdBy: true },
      where: and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId))
    });

    if (!prev) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // #2698 — this route writes contacts.lead_status, the same column
    // contacts/[id]:162 maps, and it was reachable by exactly the callers
    // contacts/[id]:195-200 refuses: `sales_rep` holds contacts.edit
    // (definitions.ts:133) and not contacts.view_all.
    if (!can(ctx, 'contacts.view_all')) {
      if (prev.assignedTo !== ctx.userId && prev.createdBy !== ctx.userId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }

    const description = `Status: ${prev.leadStatus} → ${lead_status}${reason ? ` — ${reason}` : ''}`;

    const [contact] = await db.transaction(async (tx) => {
      const [c] = await tx.update(contacts)
        .set({ 
          leadStatus: lead_status, 
          updatedAt: new Date() 
        })
        .where(and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)))
        .returning();

      await tx.insert(activities).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        contactId: id,
        eventType: 'note',
        description,
        metadata: { 
          status_change: true, 
          from: prev.leadStatus, 
          to: lead_status, 
          reason 
        },
        entityType: 'contact',
        entityId: id,
        action: 'status_change',
      });

      return [c];
    });

    return NextResponse.json({ data: contact });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});
