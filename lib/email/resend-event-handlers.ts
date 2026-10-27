/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2406 — what the Resend webhook does once it knows whose event this is.
 *
 * Three write paths, each bounded to the one workspace the attribution named.
 * They live here rather than in `app/api/webhooks/resend/route.ts` because that
 * route is capped at 500 lines by the #1843/#422 size ratchet, and binding the
 * statements below to a context-establishing call — which is what #3246 step 4b
 * did — cannot fit inside a file that was already at 491.
 *
 * `withTenantContext` is not decoration on top of the session GUC the caller
 * adopted: it is what makes the binding checkable. The guard
 * (`scripts/check-portal-rls-context.mts`) credits a statement only when its
 * handle comes from a context-establishing call, and a bare `db.*` runs on a
 * different connection than the one that adopted the tenant.
 *
 * Proprietary & confidential.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { activities, contacts, sequenceEnrollments } from '@/drizzle/schema';
import { NO_USER_SENTINEL, withTenantContext } from '@/lib/db/rls';
import { logError } from '@/lib/errors-server';
import type { AttributedScope } from '@/lib/email/webhook-scope';

/** Soft bounce threshold: DNC after this many soft bounces within the window */
const SOFT_BOUNCE_THRESHOLD = 3;
/** Window in days for soft bounce threshold */
const SOFT_BOUNCE_WINDOW_DAYS = 7;

/*
 * #3246: every statement below runs inside a `withTenantContext` transaction,
 * because that transaction is the unit RLS is evaluated in and the workspace it
 * writes was resolved by the attribution in `lib/email/webhook-scope.ts`. The
 * explicit `tenant_id` predicates stay: #2406 argued for them, and a predicate
 * the policy now also enforces is still the one that keeps a future copy of a
 * block honest.
 */

/**
 * Handle a hard bounce or complaint: immediately set doNotContact=true
 * and cancel active sequence enrollments.
 *
 * #2406: every statement here is bounded to ONE workspace. The event that
 * reaches this function names a recipient, not a tenant, and `contacts.email`
 * is not globally unique — two customers may hold the same person. Matching on
 * the address alone suppressed marketing in every workspace that had the
 * contact and cancelled their enrollments in the same transaction, with no
 * audit row for the customer who lost the mailing.
 */
export async function handleHardBounce(scope: AttributedScope, email: string, eventType: string): Promise<void> {
  // DNC flag + enrollment cancellation must be atomic: a contact flagged
  // do-not-contact whose enrollments were left active would keep sending.
  const affectedContacts = await withTenantContext(scope.tenantId, NO_USER_SENTINEL, async (tx) => {
    const updatedContacts = await tx
      .update(contacts)
      .set({
        doNotContact: true,
        // The ::text below is load-bearing: jsonb_build_object takes "any", so
        // an untyped bind parameter is rejected at parse time (42P18) and the
        // whole transaction — including do_not_contact — aborts. See #2421.
        metadata: sql`jsonb_set(
          COALESCE(${contacts.metadata}, '{}'::jsonb),
          '{bounceType}',
          '"hard"'
        ) || jsonb_build_object('lastBounceAt', ${new Date().toISOString()}::text)`,
        updatedAt: new Date()
      })
      .where(and(
        eq(contacts.tenantId, scope.tenantId),
        // An exact scope already names the row the send went to; the address
        // check stays so a mismatched pair cannot flag a different contact.
        ...(scope.kind === 'exact' ? [eq(contacts.id, scope.contactId)] : []),
        eq(contacts.email, email),
        eq(contacts.doNotContact, false),
        isNull(contacts.deletedAt)
      ))
      .returning({
        id: contacts.id,
        tenantId: contacts.tenantId,
        firstName: contacts.firstName
      });

    if (updatedContacts.length > 0) {
      const contactIds = updatedContacts.map(c => c.id);
      await tx
        .update(sequenceEnrollments)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(
          inArray(sequenceEnrollments.contactId, contactIds),
          eq(sequenceEnrollments.status, 'active'),
          eq(sequenceEnrollments.tenantId, scope.tenantId)
        ));
    }

    return updatedContacts;
  });

  if (affectedContacts.length > 0) {
    // #2529: domain-only, matching the DROP line in the route. The full address plus the
    // fact that this contact went DNC is GDPR-relevant behaviour, and stdout here is
    // shipped to Loki — retained outside the erasure boundary this repo implements.
    console.log(`[resend-webhook] ${eventType} (hard): ${affectedContacts.length} contact(s) marked DNC for ${email.split('@')[1] ?? 'no-domain'}`);

    // Activity logging is deliberately AFTER the commit and non-fatal: its own
    // transaction, inside the same tenant context, so a constraint violation
    // here cannot roll back the compliance-critical DNC flag above.
    const activityInserts = affectedContacts.map(contact => ({
      tenantId: contact.tenantId,
      contactId: contact.id,
      eventType: 'note',
      description: eventType === 'email.bounced'
        ? `Hard bounce detected - do not contact flag set automatically`
        : `Email complaint received - do not contact flag set automatically`,
      entityType: 'contact',
      entityId: contact.id,
      action: eventType
    }));

    try {
      await withTenantContext(scope.tenantId, NO_USER_SENTINEL, (tx) => tx.insert(activities).values(activityInserts));
    } catch (activityErr) {
      await logError({ error: activityErr, context: 'resend-webhook:activity-log' });
    }
  }
}

/**
 * Handle a reply: cancel active sequence enrollments for the replying
 * contact so no further follow-ups are sent to someone who already engaged.
 * Unlike bounces/complaints, a reply must not set doNotContact.
 */
export async function handleReply(scope: AttributedScope, email: string): Promise<void> {
  const [contact] = await withTenantContext(scope.tenantId, NO_USER_SENTINEL, (tx) =>
    tx
      .select({ id: contacts.id, tenantId: contacts.tenantId })
      .from(contacts)
      .where(and(
        // #2406: with no tenant predicate this `.limit(1)` picked whichever
        // workspace Postgres happened to return first and stopped ITS follow-ups
        // for a reply that belonged to someone else's campaign.
        eq(contacts.tenantId, scope.tenantId),
        ...(scope.kind === 'exact' ? [eq(contacts.id, scope.contactId)] : []),
        eq(contacts.email, email),
        isNull(contacts.deletedAt)
      ))
      .limit(1));

  if (!contact) return;

  const cancelled = await withTenantContext(scope.tenantId, NO_USER_SENTINEL, (tx) =>
    tx
      .update(sequenceEnrollments)
      .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(sequenceEnrollments.contactId, contact.id),
        eq(sequenceEnrollments.status, 'active'),
        eq(sequenceEnrollments.tenantId, contact.tenantId)
      ))
      .returning({ id: sequenceEnrollments.id }));

  if (cancelled.length > 0) {
    // #2529: domain-only, as above.
    console.log(`[resend-webhook] email.replied: cancelled ${cancelled.length} active sequence enrollment(s) for ${email.split('@')[1] ?? 'no-domain'}`);
  }

  // Activity logging is deliberately AFTER the update and non-fatal.
  try {
    await withTenantContext(scope.tenantId, NO_USER_SENTINEL, (tx) =>
      tx.insert(activities).values({
        tenantId: contact.tenantId,
        contactId: contact.id,
        eventType: 'note',
        description: `Contact replied to an email - active sequence follow-ups stopped`,
        entityType: 'contact',
        entityId: contact.id,
        action: 'email.replied'
      }));
  } catch (activityErr) {
    await logError({ error: activityErr, context: 'resend-webhook:activity-log' });
  }
}

/**
 * Handle a soft bounce: increment bounce counter in metadata and escalate
 * to doNotContact after SOFT_BOUNCE_THRESHOLD bounces within the window.
 */
export async function handleSoftBounce(scope: AttributedScope, email: string): Promise<void> {
  // Fetch contacts with this email — in ONE workspace (#2406: this unscoped
  // read is what made a soft bounce a fleet-wide event, because every tenant
  // holding the address was iterated and incremented).
  const matchingContacts = await withTenantContext(scope.tenantId, NO_USER_SENTINEL, (tx) =>
    tx
      .select({ id: contacts.id, tenantId: contacts.tenantId, metadata: contacts.metadata })
      .from(contacts)
      .where(and(
        eq(contacts.tenantId, scope.tenantId),
        ...(scope.kind === 'exact' ? [eq(contacts.id, scope.contactId)] : []),
        eq(contacts.email, email),
        eq(contacts.doNotContact, false),
        isNull(contacts.deletedAt)
      )));

  if (matchingContacts.length === 0) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - SOFT_BOUNCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  for (const contact of matchingContacts) {
    // Atomic read-modify-write: lock the contact row (SELECT ... FOR UPDATE)
    // so two concurrent soft bounces cannot read the same starting metadata
    // and lose an increment. The pruning of stale (>window) bounces and the
    // DNC threshold evaluation both require the post-append array, so we do
    // the whole compute inside the locked transaction rather than in a single
    // SQL statement.
    const escalated = await withTenantContext(scope.tenantId, NO_USER_SENTINEL, async (tx): Promise<{ newCount: number; shouldDnc: boolean } | null> => {
      // Re-read metadata under a row lock so the value cannot change until commit.
      const locked = await tx
        .select({ id: contacts.id, metadata: contacts.metadata })
        .from(contacts)
        .where(and(
          eq(contacts.id, contact.id),
          // #2406: redundant against the scoped read above, and kept anyway —
          // every statement that touches a contact from this webhook carries its
          // tenant, so no future copy of this block can reintroduce the leak.
          eq(contacts.tenantId, scope.tenantId),
          eq(contacts.doNotContact, false),
          isNull(contacts.deletedAt)
        ))
        .for('update');

      // Row may have been escalated/deleted by a concurrent update between the
      // initial select and acquiring the lock — nothing to do.
      const lockedContact = locked[0];
      if (!lockedContact) return null;

      const meta = (lockedContact.metadata as Record<string, unknown> | null) ?? {};
      const bounces: string[] = Array.isArray(meta.softBounces) ? meta.softBounces : [];

      // Prune bounces outside the window, then append the current one.
      const recentBounces = bounces.filter(ts => new Date(ts) >= windowStart);
      recentBounces.push(now.toISOString());

      const newCount = recentBounces.length;
      const shouldDnc = newCount >= SOFT_BOUNCE_THRESHOLD;

      if (shouldDnc) {
        await tx
          .update(contacts)
          .set({
            doNotContact: true,
            metadata: sql`jsonb_set(
              jsonb_set(
                COALESCE(${contacts.metadata}, '{}'::jsonb),
                '{bounceType}', '"soft_escalated"'
              ),
              '{softBounces}', ${JSON.stringify(recentBounces)}::jsonb
            ) || jsonb_build_object('lastBounceAt', ${now.toISOString()}::text, 'bounceCount', ${newCount}::int)`,
            updatedAt: now,
          })
          .where(and(
            eq(contacts.id, contact.id),
            eq(contacts.tenantId, scope.tenantId)
          ));

        // Cancel enrollments
        await tx
          .update(sequenceEnrollments)
          .set({ status: 'cancelled', updatedAt: now })
          .where(and(
            eq(sequenceEnrollments.contactId, contact.id),
            eq(sequenceEnrollments.status, 'active'),
            eq(sequenceEnrollments.tenantId, scope.tenantId)
          ));
      } else {
        // Just track the soft bounce
        await tx
          .update(contacts)
          .set({
            metadata: sql`jsonb_set(
              jsonb_set(
                COALESCE(${contacts.metadata}, '{}'::jsonb),
                '{bounceType}', '"soft"'
              ),
              '{softBounces}', ${JSON.stringify(recentBounces)}::jsonb
            ) || jsonb_build_object('lastBounceAt', ${now.toISOString()}::text, 'bounceCount', ${newCount}::int)`,
            updatedAt: now,
          })
          .where(and(
            eq(contacts.id, contact.id),
            eq(contacts.tenantId, scope.tenantId)
          ));
      }

      return { newCount, shouldDnc };
    });

    if (!escalated) continue;

    if (escalated.shouldDnc) {
      console.log(`[resend-webhook] Soft bounce escalated to DNC for contact ${contact.id} (${escalated.newCount} bounces)`);

      // Activity logging is deliberately AFTER the commit and non-fatal.
      try {
        await withTenantContext(scope.tenantId, NO_USER_SENTINEL, (tx) =>
          tx.insert(activities).values({
            tenantId: contact.tenantId,
            contactId: contact.id,
            eventType: 'note',
            description: `Soft bounce threshold reached (${escalated.newCount} within ${SOFT_BOUNCE_WINDOW_DAYS} days) - do not contact flag set automatically`,
            entityType: 'contact',
            entityId: contact.id,
            action: 'email.soft_bounce_escalated'
          }));
      } catch (activityErr) {
        await logError({ error: activityErr, context: 'resend-webhook:activity-log' });
      }
    } else {
      console.log(`[resend-webhook] Soft bounce tracked for contact ${contact.id} (${escalated.newCount}/${SOFT_BOUNCE_THRESHOLD})`);
    }
  }
}
