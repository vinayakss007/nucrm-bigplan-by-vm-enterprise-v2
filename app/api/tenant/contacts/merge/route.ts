import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, activities, leads, tasks, tenants } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';

/**
 * POST /api/tenant/contacts/merge
 * Merge two duplicate contacts into one.
 *
 * Body: { primary_id: string, duplicate_id: string }
 *
 * The duplicate's related records (deals, activities, tasks, leads) are
 * reassigned to the primary contact. The duplicate is then soft-deleted.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'contacts-merge', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const { primary_id, duplicate_id } = body as { primary_id?: string; duplicate_id?: string };

    if (!primary_id || !duplicate_id) {
      return NextResponse.json({ error: 'primary_id and duplicate_id required' }, { status: 400 });
    }

    if (primary_id === duplicate_id) {
      return NextResponse.json({ error: 'Cannot merge a contact with itself' }, { status: 400 });
    }

    // Verify both contacts exist and belong to tenant
    const [primary] = await db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.id, primary_id), eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`))
      .limit(1);

    const [duplicate] = await db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.id, duplicate_id), eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`))
      .limit(1);

    if (!primary) return NextResponse.json({ error: 'Primary contact not found' }, { status: 404 });
    if (!duplicate) return NextResponse.json({ error: 'Duplicate contact not found' }, { status: 404 });

    // Merge in a transaction
    await db.transaction(async (tx) => {
      // Reassign deals from duplicate to primary
      await tx.update(deals)
        .set({ contactId: primary_id })
        .where(and(eq(deals.contactId, duplicate_id), eq(deals.tenantId, ctx.tenantId)));

      // Reassign activities
      await tx.update(activities)
        .set({ contactId: primary_id })
        .where(and(eq(activities.contactId, duplicate_id), eq(activities.tenantId, ctx.tenantId)));

      // Reassign tasks
      await tx.update(tasks)
        .set({ contactId: primary_id })
        .where(and(eq(tasks.contactId, duplicate_id), eq(tasks.tenantId, ctx.tenantId)));

      // Reassign leads
      await tx.update(leads)
        .set({ contactId: primary_id })
        .where(and(eq(leads.contactId, duplicate_id), eq(leads.tenantId, ctx.tenantId)));

      // Soft-delete the duplicate
      await tx.update(contacts)
        .set({
          deletedAt: new Date(),
          deletedBy: ctx.userId,
          metadata: sql`jsonb_set(COALESCE(${contacts.metadata}, '{}'), '{merged_into}', ${JSON.stringify(primary_id)}::jsonb)`,
        })
        .where(eq(contacts.id, duplicate_id));

      // Decrement tenant's currentContacts counter
      await tx.update(tenants).set({
        currentContacts: sql`GREATEST(${tenants.currentContacts} - 1, 0)`,
      }).where(eq(tenants.id, ctx.tenantId));

      // Log the merge as an activity
      await tx.insert(activities).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entityType: 'contact',
        entityId: primary_id,
        contactId: primary_id,
        eventType: 'contact_update',
        action: 'merge',
        description: `Merged duplicate contact "${duplicate.firstName} ${duplicate.lastName}" into this record`,
      });
    });

    return NextResponse.json({
      data: {
        primary_id,
        duplicate_id,
        merged: true,
        message: `Successfully merged "${duplicate.firstName} ${duplicate.lastName}" into "${primary.firstName} ${primary.lastName}"`,
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
