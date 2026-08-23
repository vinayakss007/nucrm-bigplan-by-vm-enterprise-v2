/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, activities, leads, tasks, tenants, contactTags, followUps, recordLinks, contactScores, contactMergeHistory } from '@/drizzle/schema';
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
 * reassigned to the primary contact. Tags, custom fields, follow-ups, and
 * conversion links are merged/preserved. The duplicate is then soft-deleted.
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
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, tags: contacts.tags, customFields: contacts.customFields })
      .from(contacts)
      .where(and(eq(contacts.id, primary_id), eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`))
      .limit(1);

    const [duplicate] = await db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, tags: contacts.tags, customFields: contacts.customFields })
      .from(contacts)
      .where(and(eq(contacts.id, duplicate_id), eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`))
      .limit(1);

    if (!primary) return NextResponse.json({ error: 'Primary contact not found' }, { status: 404 });
    if (!duplicate) return NextResponse.json({ error: 'Duplicate contact not found' }, { status: 404 });

    // Merge in a transaction
    await db.transaction(async (tx) => {
      // ── 1. Merge tags (combine array + reassign junction rows) ──
      const primaryTags = (primary.tags ?? []) as string[];
      const duplicateTags = (duplicate.tags ?? []) as string[];
      const mergedTags = [...new Set([...primaryTags, ...duplicateTags])];

      await tx.update(contacts)
        .set({ tags: mergedTags })
        .where(eq(contacts.id, primary_id));

      // Reassign contactTags junction rows (INSERT ON CONFLICT for idempotency)
      const dupContactTags = await tx
        .select({ tagId: contactTags.tagId })
        .from(contactTags)
        .where(eq(contactTags.contactId, duplicate_id));

      for (const row of dupContactTags) {
        await tx.insert(contactTags)
          .values({ contactId: primary_id, tagId: row.tagId })
          .onConflictDoNothing();
      }

      // Delete duplicate's contactTags
      await tx.delete(contactTags)
        .where(eq(contactTags.contactId, duplicate_id));

      // ── 2. Merge custom fields (deep merge, primary wins on conflict) ──
      const primaryCF = (primary.customFields ?? {}) as Record<string, unknown>;
      const duplicateCF = (duplicate.customFields ?? {}) as Record<string, unknown>;
      const mergedCF = { ...duplicateCF, ...primaryCF };

      await tx.update(contacts)
        .set({ customFields: mergedCF })
        .where(eq(contacts.id, primary_id));

      // ── 3. Reassign deals ──
      await tx.update(deals)
        .set({ contactId: primary_id })
        .where(and(eq(deals.contactId, duplicate_id), eq(deals.tenantId, ctx.tenantId)));

      // ── 4. Reassign activities ──
      await tx.update(activities)
        .set({ contactId: primary_id })
        .where(and(eq(activities.contactId, duplicate_id), eq(activities.tenantId, ctx.tenantId)));

      // ── 5. Reassign tasks ──
      await tx.update(tasks)
        .set({ contactId: primary_id })
        .where(and(eq(tasks.contactId, duplicate_id), eq(tasks.tenantId, ctx.tenantId)));

      // ── 6. Reassign leads ──
      await tx.update(leads)
        .set({ contactId: primary_id })
        .where(and(eq(leads.contactId, duplicate_id), eq(leads.tenantId, ctx.tenantId)));

      // ── 7. Update leads.convertedContactId (conversion links) ──
      await tx.update(leads)
        .set({ convertedContactId: primary_id })
        .where(and(eq(leads.convertedContactId, duplicate_id), eq(leads.tenantId, ctx.tenantId)));

      // ── 8. Reassign follow-ups ──
      await tx.update(followUps)
        .set({ contactId: primary_id })
        .where(and(eq(followUps.contactId, duplicate_id), eq(followUps.tenantId, ctx.tenantId)));

      // ── 9. Reassign record links (conversion/related links) ──
      await tx.update(recordLinks)
        .set({ fromId: primary_id })
        .where(and(
          eq(recordLinks.fromType, 'contact'),
          eq(recordLinks.fromId, duplicate_id),
          eq(recordLinks.tenantId, ctx.tenantId),
        ));

      await tx.update(recordLinks)
        .set({ toId: primary_id })
        .where(and(
          eq(recordLinks.toType, 'contact'),
          eq(recordLinks.toId, duplicate_id),
          eq(recordLinks.tenantId, ctx.tenantId),
        ));

      // ── 10. Reassign contact scores ──
      await tx.update(contactScores)
        .set({ contactId: primary_id })
        .where(and(eq(contactScores.contactId, duplicate_id), eq(contactScores.tenantId, ctx.tenantId)));

      // ── 11. Record merge history ──
      const mergedFields: Record<string, { primary: unknown; duplicate: unknown }> = {};
      if (primaryTags.length === 0 && duplicateTags.length > 0) {
        mergedFields.tags = { primary: primaryTags, duplicate: duplicateTags };
      }
      if (Object.keys(primaryCF).length === 0 && Object.keys(duplicateCF).length > 0) {
        mergedFields.customFields = { primary: primaryCF, duplicate: duplicateCF };
      }

      await tx.insert(contactMergeHistory).values({
        tenantId: ctx.tenantId,
        primaryContactId: primary_id,
        mergedContactId: duplicate_id,
        mergedBy: ctx.userId,
        mergedFields,
        reason: 'Contact merge',
      });

      // ── 12. Soft-delete the duplicate ──
      await tx.update(contacts)
        .set({
          deletedAt: new Date(),
          deletedBy: ctx.userId,
          metadata: sql`jsonb_set(COALESCE(${contacts.metadata}, '{}'), '{merged_into}', ${JSON.stringify(primary_id)}::jsonb)`,
        })
        .where(eq(contacts.id, duplicate_id));

      // Decrement contact counter (duplicate is effectively removed)
      await tx.update(tenants)
        .set({ currentContacts: sql`greatest(0, ${tenants.currentContacts} - 1)` })
        .where(eq(tenants.id, ctx.tenantId));

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
