/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Public buyer view of an offer
 *
 *   GET /api/public/offers/[publicToken]
 *
 * No auth — the token IS the credential. Always 404 cleanly on any failure
 * mode (wrong token, cancelled offer, expired offer) so an unauthenticated
 * probe can't enumerate state.
 *
 * On the first valid view we set status to 'viewed' and increment
 * `metadata.offer.viewed_count` so the seller dashboard can show "buyer
 * opened the offer" without a separate tracking pixel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { quotes, quoteLineItems, contacts, tenants } from '@/drizzle/schema';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';
import { canTransition, findOfferByToken, incrementOfferViewedCount, patchOfferMetadata } from '@/lib/offers';

/**
 * What the one transaction decided. Mapped to a response below, outside the RLS
 * context, so no branch of this handler can hand the pool a connection that is
 * still holding a half-marked offer — #2446's K2 rule, same shape as
 * app/api/public/quotes/[id]/accept/route.ts.
 */
type OfferViewOutcome =
  | { kind: 'expired' }
  | {
      kind: 'found';
      offer: Record<string, unknown>;
      lineItems: Record<string, unknown>[];
      seller: Record<string, unknown>;
    };

export async function GET(req: NextRequest, { params }: { params: Promise<{ publicToken: string }> }) {
  try {
    // Rate-limit aggressively — public unauthenticated route
    const limited = await checkRateLimit(req, { action: 'public_offer_view', max: 60, windowMinutes: 5 });
    if (limited) return limited;

    const { publicToken } = await params;
    // #2468: the credential read opens its own lookup context (lib/offers.ts), and
    // the row it returns is the only thing that may name a workspace below.
    const offer = await findOfferByToken(publicToken);
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    // Reject terminal-state and cancelled offers (treat as not found to the public)
    if (!['sent', 'viewed'].includes(offer.status ?? '')) {
      // For accepted / declined, we DO want the buyer to see the final state
      if (!['accepted', 'declined'].includes(offer.status ?? '')) {
        return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
      }
    }

    // From the auto-expire write through the branding read, every statement here
    // touches a tenant-policyed table (`quotes`, `quote_line_items`, `contacts`,
    // `tenants`) — and all of it used to run on the bare pool with no GUC set, so
    // the reads matched nothing while the writes sat one policy-change away from
    // being refused outright. One transaction, scoped to the tenant the credential
    // resolved, which also keeps H7 (status + viewed metadata commit together)
    // inside the context that makes those writes reachable at all.
    const outcome = await withTenantContext(offer.tenantId, NO_USER_SENTINEL, async (tx): Promise<OfferViewOutcome> => {
      // Auto-expire if past expiry
      if (
        offer.expiresAt
        && new Date(offer.expiresAt).getTime() < Date.now()
        && (offer.status === 'sent' || offer.status === 'viewed')
      ) {
        await tx.update(quotes).set({ status: 'expired', updatedAt: new Date() }).where(eq(quotes.id, offer.id));
        return { kind: 'expired' };
      }

      // Mark as viewed if first open — status + viewed metadata written atomically
      // in one tx so the offer is never marked 'viewed' without its viewed_at/
      // viewed_count metadata (H7). patchOfferMetadata takes the tx.
      if (offer.status === 'sent') {
        if (canTransition(offer.status, 'viewed')) {
          // #2344: viewed_count is incremented by Postgres inside jsonb_set, not
          // computed from the pre-read `offer` row.
          await tx.update(quotes).set({ status: 'viewed', updatedAt: new Date() }).where(eq(quotes.id, offer.id));
          await patchOfferMetadata(offer.id, offer.tenantId, {
            viewed_at: new Date().toISOString(),
          }, tx);
          await incrementOfferViewedCount(offer.id, offer.tenantId, tx);
        }
      } else if (offer.status === 'viewed') {
        // #2344: no sibling status write here — a single-statement atomic
        // increment needs no surrounding transaction.
        await incrementOfferViewedCount(offer.id, offer.tenantId, tx);
      }

      const items = await tx
        .select({
          id: quoteLineItems.id,
          description: quoteLineItems.description,
          quantity: quoteLineItems.quantity,
          unit_price: quoteLineItems.unitPrice,
          discount_percent: quoteLineItems.discountPercent,
          tax_percent: quoteLineItems.taxPercent,
          total: quoteLineItems.total,
          sort_order: quoteLineItems.sortOrder,
        })
        .from(quoteLineItems)
        .where(and(eq(quoteLineItems.quoteId, offer.id), isNull(quoteLineItems.deletedAt)))
        .orderBy(asc(quoteLineItems.sortOrder));

      // Look up the contact's display name (no email — that would help phishing)
      let buyerName = '';
      if (offer.contactId) {
        const c = await tx.query.contacts.findFirst({
          where: and(eq(contacts.id, offer.contactId), isNull(contacts.deletedAt)),
          columns: { firstName: true, lastName: true },
        });
        if (c) buyerName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
      }

      // Show the seller's workspace branding (name only)
      const tenant = await tx.query.tenants.findFirst({
        where: and(eq(tenants.id, offer.tenantId), isNull(tenants.deletedAt)),
        columns: { name: true, logoUrl: true, primaryColor: true },
      });

      return {
        kind: 'found',
        offer: {
          id: offer.id,
          quote_number: offer.quoteNumber,
          title: offer.title,
          status: offer.status,
          subtotal: offer.subtotal,
          discount: offer.discount,
          tax: offer.tax,
          total_amount: offer.totalAmount,
          expires_at: offer.expiresAt,
          notes: offer.notes,
          terms: offer.terms,
          sent_at: offer.sentAt,
          accepted_at: offer.acceptedAt,
          declined_at: offer.declinedAt,
          buyer_name: buyerName,
        },
        lineItems: items as Record<string, unknown>[],
        seller: {
          name: tenant?.name ?? 'Seller',
          logo: tenant?.logoUrl ?? null,
          primary_color: tenant?.primaryColor ?? '#7c3aed',
        },
      };
    });

    if (outcome.kind === 'expired') return NextResponse.json({ error: 'This offer has expired' }, { status: 410 });

    return NextResponse.json({
      offer: outcome.offer,
      line_items: outcome.lineItems,
      seller: outcome.seller,
    });
  } catch (err) {
    return apiError(err);
  }
}
