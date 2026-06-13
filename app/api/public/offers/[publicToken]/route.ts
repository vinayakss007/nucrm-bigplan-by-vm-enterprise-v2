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
import { db } from '@/drizzle/db';
import { quotes, quoteLineItems, contacts, tenants } from '@/drizzle/schema';
import { eq, asc } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  findOfferByToken,
  patchOfferMetadata,
  readOfferMetadata,
  canTransition,
} from '@/lib/offers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ publicToken: string }> }) {
  try {
    // Rate-limit aggressively — public unauthenticated route
    const limited = await checkRateLimit(req, { action: 'public_offer_view', max: 60, windowMinutes: 5 });
    if (limited) return limited;

    const { publicToken } = await params;
    const offer = await findOfferByToken(publicToken);
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    // Reject terminal-state and cancelled offers (treat as not found to the public)
    if (!['sent', 'viewed'].includes(offer.status ?? '')) {
      // For accepted / declined, we DO want the buyer to see the final state
      if (!['accepted', 'declined'].includes(offer.status ?? '')) {
        return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
      }
    }

    // Auto-expire if past expiry
    if (offer.expiresAt && new Date(offer.expiresAt).getTime() < Date.now() && (offer.status === 'sent' || offer.status === 'viewed')) {
      await db.update(quotes).set({ status: 'expired', updatedAt: new Date() }).where(eq(quotes.id, offer.id));
      return NextResponse.json({ error: 'This offer has expired' }, { status: 410 });
    }

    // Mark as viewed if first open
    if (offer.status === 'sent') {
      const meta = readOfferMetadata(offer);
      if (canTransition(offer.status, 'viewed')) {
        await db.update(quotes).set({ status: 'viewed', updatedAt: new Date() }).where(eq(quotes.id, offer.id));
        await patchOfferMetadata(offer.id, offer.tenantId, {
          viewed_at: new Date().toISOString(),
          viewed_count: (meta.viewed_count ?? 0) + 1,
        });
      }
    } else if (offer.status === 'viewed') {
      const meta = readOfferMetadata(offer);
      await patchOfferMetadata(offer.id, offer.tenantId, {
        viewed_count: (meta.viewed_count ?? 0) + 1,
      });
    }

    // Pull line items
    const items = await db
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
      .where(eq(quoteLineItems.quoteId, offer.id))
      .orderBy(asc(quoteLineItems.sortOrder));

    // Look up the contact's display name (no email — that would help phishing)
    let buyerName = '';
    if (offer.contactId) {
      const c = await db.query.contacts.findFirst({
        where: eq(contacts.id, offer.contactId),
        columns: { firstName: true, lastName: true },
      });
      if (c) buyerName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    }

    // Show the seller's workspace branding (name only)
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, offer.tenantId),
      columns: { name: true, logoUrl: true, primaryColor: true },
    });

    return NextResponse.json({
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
      line_items: items,
      seller: {
        name: tenant?.name ?? 'Seller',
        logo: tenant?.logoUrl ?? null,
        primary_color: tenant?.primaryColor ?? '#7c3aed',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
