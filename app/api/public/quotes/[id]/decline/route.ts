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
import { readJsonBody } from '@/lib/api/validate';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';

/**
 * What the one transaction decided. Mapped to a response below, outside the RLS
 * context, so no branch of this handler can answer while leaving the write half
 * applied.
 */
type DeclineOutcome =
  | { kind: 'no_contact' }
  | { kind: 'no_quote' }
  | { kind: 'bad_state' }
  | { kind: 'declined'; declinedAt: Date; tenantId: string; quoteId: string };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-quote-decline', max: 10, windowMinutes: 1 });
    if (limited) return limited;

    // #1913 (same class as #1133): the old x-portal-email header was spoofable
    // — anyone could decline any customer's quotes by setting it. Identity now
    // comes from resolvePortalIdentity(): a validated x-portal-token header
    // or the httpOnly portal session cookie. The contact lookup is scoped to
    // (email, tenantId) so one tenant's email can't resolve another's contact.
    const identity = await resolvePortalIdentity(request);
    if (!identity) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const email = identity.email;
    const { id } = await params;

    let reason = '';
    try {
      const body = await readJsonBody(request);
      reason = (body.reason ?? '').trim();
    } catch { /* no body is fine */ }

    // #2446: every read here (`contacts`, `quotes`) and every write (`quotes`,
    // `activities`) is policy-bound, and none of them had a context — the
    // contact resolved to nobody and a customer with a live quote got 404. The
    // reason is parsed first because the body is read off the request, not the
    // database; the query itself must not sit inside the transaction while we
    // await a network stream.
    const outcome = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx): Promise<DeclineOutcome> => {
      // #2382: same rule as accept — a tombstoned contact resolves to nobody.
      const contact = await resolvePortalContact(identity, tx);
      if (!contact) return { kind: 'no_contact' };

      // #2443: these reads never reach the wire — the response is the three-field
      // `{ ok, status, declined_at }` below — so they were not leaking anything.
      // They still named nothing, which makes `SELECT *` the plan for a statement
      // that tests two columns and copies three into an activity row.
      const [quote] = await tx
        .select({
          id: quotes.id,
          tenantId: quotes.tenantId,
          status: quotes.status,
          title: quotes.title,
          dealId: quotes.dealId,
        })
        .from(quotes)
        .where(and(eq(quotes.id, id), eq(quotes.tenantId, contact.tenantId), eq(quotes.contactId, contact.id), isNull(quotes.deletedAt)))
        .limit(1);

      if (!quote) return { kind: 'no_quote' };

      const validStatuses = ['sent', 'viewed'];
      if (!validStatuses.includes(quote.status ?? '')) return { kind: 'bad_state' };

      const now = new Date();
      await tx
        .update(quotes)
        .set({ status: 'declined', declinedAt: now, updatedAt: now })
        .where(eq(quotes.id, quote.id));

      await tx.insert(activities).values({
        tenantId: quote.tenantId,
        userId: null,
        entityType: 'quote',
        entityId: quote.id,
        contactId: contact.id,
        dealId: quote.dealId ?? null,
        eventType: 'offer_declined',
        description: `Client declined quote "${quote.title}"${reason ? ` — ${reason}` : ''}`,
        metadata: { quote_id: quote.id, decline_reason: reason, email },
      });

      return {
        kind: 'declined',
        declinedAt: now,
        tenantId: quote.tenantId,
        quoteId: quote.id,
      };
    });

    // K2: the transaction's decisions are returned as data and mapped to
    // responses here, outside the RLS context.
    if (outcome.kind === 'no_contact') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (outcome.kind === 'no_quote') return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    if (outcome.kind === 'bad_state') {
      return NextResponse.json({ error: 'Quote cannot be declined in its current state' }, { status: 409 });
    }

    await logAudit({
      tenantId: outcome.tenantId,
      action: 'offer_declined',
      entityType: 'quote',
      entityId: outcome.quoteId,
      newData: { reason, email },
    });

    return NextResponse.json({ ok: true, status: 'declined', declined_at: outcome.declinedAt.toISOString() });
  } catch (err) {
    return apiError(err);
  }
}
