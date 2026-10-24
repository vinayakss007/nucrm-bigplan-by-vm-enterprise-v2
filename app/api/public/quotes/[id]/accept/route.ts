/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { quotes, activities } from '@/drizzle/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';
import { allowedFromStatus, canTransition } from '@/lib/offers';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';

/**
 * What the one transaction decided. Mapped to a response below, outside the
 * RLS context, so no branch of this handler can leave the transaction holding a
 * half-done accept.
 */
type AcceptOutcome =
  | { kind: 'no_contact' }
  | { kind: 'no_quote' }
  | { kind: 'bad_state' }
  | { kind: 'expired' }
  /**
   * The guarded write matched no row: the quote moved between the read and the
   * `UPDATE`. `committedStatus` is what the column holds now, re-read after the
   * losing claim.
   */
  | { kind: 'conflict'; committedStatus: string }
  | { kind: 'accepted'; acceptedAt: Date; tenantId: string; quoteId: string };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-quote-accept', max: 10, windowMinutes: 1 });
    if (limited) return limited;

    // #1913 (same class as #1133): the old x-portal-email header was spoofable
    // — anyone could accept any customer's quotes by setting it. Identity now
    // comes from resolvePortalIdentity(): a validated x-portal-token header
    // or the httpOnly portal session cookie. The contact lookup is scoped to
    // (email, tenantId) so one tenant's email can't resolve another's contact.
    const identity = await resolvePortalIdentity(request);
    if (!identity) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const { id } = await params;
    const email = identity.email;

    // #2446: this handler touches four policy-bound tables (`contacts`, `quotes`,
    // `activities`, and the `audit_logs` row below) and set no context for any of
    // them, so the accept was unreachable — the contact read matched nothing and
    // the answer was 404 "Not found" for a customer with a live quote. Everything
    // from the contact lookup to the activity insert now runs in ONE transaction
    // scoped to the tenant the credential names, which is also what keeps the
    // status flip and the activity row atomic (they were already one transaction;
    // they are now also one context).
    const outcome = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx): Promise<AcceptOutcome> => {
      const contact = await resolvePortalContact(identity, tx);
      if (!contact) return { kind: 'no_contact' };

      // #2443: these reads never reach the wire — the response is the three-field
      // `{ ok, status, accepted_at }` below — so they were not leaking anything.
      // They still named nothing, which makes `SELECT *` the plan for a statement
      // that tests two columns and copies five into an activity row. Naming them
      // costs less to fetch and makes "what does this handler look at" readable
      // without diffing the table.
      const [quote] = await tx
        .select({
          id: quotes.id,
          tenantId: quotes.tenantId,
          status: quotes.status,
          expiresAt: quotes.expiresAt,
          title: quotes.title,
          dealId: quotes.dealId,
          totalAmount: quotes.totalAmount,
        })
        .from(quotes)
        .where(and(eq(quotes.id, id), eq(quotes.tenantId, contact.tenantId), eq(quotes.contactId, contact.id), isNull(quotes.deletedAt)))
        .limit(1);

      if (!quote) return { kind: 'no_quote' };

      // #3177: `OFFER_TRANSITIONS` in lib/offers.ts is the state machine that
      // owns this column, and the seller half of its writers already claims its
      // from-set in the WHERE (#3159). This route read the row, checked it
      // against a local copy of that set, then wrote unconditionally — so the
      // later commit won the column whatever it had been checking: a cancel that
      // landed after this read was overwritten back to `accepted`, and a second
      // accept tab restamped `acceptedAt` and inserted a second activity row.
      // Both writes now claim the from-set the shipped table declares and name
      // the tenant; a zero-row result means the row moved, so the committed
      // status is re-read and returned as data, and the 409 is built outside the
      // transaction.
      if (!canTransition(String(quote.status), 'accepted')) return { kind: 'bad_state' };

      const now = new Date();

      // What a lost claim actually left behind. The re-read keeps the tombstone
      // filter (#2382), so a delete that landed while this claim was losing
      // answers as the same 404 the pre-read would have given rather than
      // reporting a status no customer can see.
      const lostClaim = async (): Promise<AcceptOutcome> => {
        const [fresh] = await tx
          .select({ status: quotes.status })
          .from(quotes)
          .where(and(eq(quotes.id, quote.id), eq(quotes.tenantId, quote.tenantId), isNull(quotes.deletedAt)))
          .limit(1);
        if (!fresh) return { kind: 'no_quote' };
        return { kind: 'conflict', committedStatus: fresh.status ?? '' };
      };

      if (quote.expiresAt && new Date(quote.expiresAt).getTime() < now.getTime()) {
        const [expired] = await tx
          .update(quotes)
          .set({ status: 'expired', updatedAt: now })
          .where(and(
            eq(quotes.id, quote.id),
            eq(quotes.tenantId, quote.tenantId),
            inArray(quotes.status, allowedFromStatus('expired')),
          ))
          .returning({ id: quotes.id });
        if (expired) return { kind: 'expired' };
        return lostClaim();
      }

      const [accepted] = await tx
        .update(quotes)
        .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
        .where(and(
          eq(quotes.id, quote.id),
          eq(quotes.tenantId, quote.tenantId),
          inArray(quotes.status, allowedFromStatus('accepted')),
        ))
        .returning({ id: quotes.id });
      if (!accepted) return lostClaim();

      await tx.insert(activities).values({
        tenantId: quote.tenantId,
        userId: null,
        entityType: 'quote',
        entityId: quote.id,
        contactId: contact.id,
        dealId: quote.dealId ?? null,
        eventType: 'offer_accepted',
        description: `Client accepted quote "${quote.title}"`,
        metadata: { quote_id: quote.id, total_amount: quote.totalAmount, accepted_by_email: email },
      });

      return {
        kind: 'accepted',
        acceptedAt: now,
        tenantId: quote.tenantId,
        quoteId: quote.id,
      };
    });

    // K2: these are the one transaction's decisions, returned as data and mapped
    // to responses here, outside the RLS context. A `NextResponse.json()` inside
    // a `db.transaction()` would have left that connection holding a half-done
    // accept when the pool handed it to the next request.
    if (outcome.kind === 'no_contact') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (outcome.kind === 'no_quote') return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    if (outcome.kind === 'bad_state') {
      return NextResponse.json({ error: 'Quote cannot be accepted in its current state' }, { status: 409 });
    }
    // #3177: the same answer the customer sees for a quote that was never in a
    // state to accept — but this one got there first. `committedStatus` is the
    // column as the database holds it, not the status this handler meant to write.
    if (outcome.kind === 'conflict') {
      return NextResponse.json(
        { error: 'Quote cannot be accepted in its current state', status: outcome.committedStatus },
        { status: 409 },
      );
    }
    if (outcome.kind === 'expired') return NextResponse.json({ error: 'Quote has expired' }, { status: 410 });

    await logAudit({
      tenantId: outcome.tenantId,
      action: 'offer_accepted',
      entityType: 'quote',
      entityId: outcome.quoteId,
      newData: { accepted_by_email: email },
    });

    return NextResponse.json({ ok: true, status: 'accepted', accepted_at: outcome.acceptedAt.toISOString() });
  } catch (err) {
    return apiError(err);
  }
}
