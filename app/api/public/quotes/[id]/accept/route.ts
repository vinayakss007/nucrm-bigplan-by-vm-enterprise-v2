/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { quotes, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';
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

      const validStatuses = ['sent', 'viewed'];
      if (!validStatuses.includes(quote.status ?? '')) return { kind: 'bad_state' };

      const now = new Date();
      if (quote.expiresAt && new Date(quote.expiresAt).getTime() < now.getTime()) {
        await tx
          .update(quotes)
          .set({ status: 'expired', updatedAt: now })
          .where(eq(quotes.id, quote.id));
        return { kind: 'expired' };
      }

      await tx
        .update(quotes)
        .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
        .where(eq(quotes.id, quote.id));

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
