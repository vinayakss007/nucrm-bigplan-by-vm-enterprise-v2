/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Cancel a sent offer
 *
 *   POST /api/tenant/offers/[quoteId]/cancel
 *
 * Sets status to 'cancelled' and clears the public_token so the buyer link
 * stops working. Cannot cancel an already-accepted/declined offer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { quotes, activities } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { canTransition, transitionOfferStatus, OfferTransitionLost } from '@/lib/offers';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { quoteId } = await params;
    if (!quoteId) return NextResponse.json({ error: 'quoteId required' }, { status: 400 });

    const quote = await db.query.quotes.findFirst({
      where: and(eq(quotes.id, quoteId), eq(quotes.tenantId, ctx.tenantId), isNull(quotes.deletedAt)),
    });
    if (!quote) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    if (!canTransition(quote.status ?? 'draft', 'cancelled')) {
      return NextResponse.json({ error: `Cannot cancel an offer in '${quote.status}' state` }, { status: 409 });
    }

    // Clear the public token so the buyer link is dead, set status, and write
    // the timeline activity — all in one db.transaction so the offer is never
    // marked 'cancelled' without its matching timeline row, and vice-versa (H7).
    //
    // #3159: the status write is conditional on the pre-tx read's allowed
    // sources (draft/sent/viewed). A buyer who accepted between that read and
    // this statement locks the row first, the guard matches zero rows, the
    // throw rolls the transaction back, and the accepted offer survives
    // instead of being silently cancelled.
    await db.transaction(async (tx) => {
      const won = await transitionOfferStatus(tx, quoteId, ['draft', 'sent', 'viewed'], {
        status: 'cancelled',
        updatedAt: new Date(),
        // Strip the public_token so /p/offers/<token> 404s cleanly going forward
        metadata: sql`
          CASE
            WHEN ${quotes.metadata}->'offer' IS NULL THEN ${quotes.metadata}
            ELSE jsonb_set(
              COALESCE(${quotes.metadata}, '{}'::jsonb),
              '{offer}',
              (${quotes.metadata}->'offer') - 'public_token'
            )
          END
        `,
      });
      if (!won) throw new OfferTransitionLost('cancelled');

      if (quote.contactId) {
        await tx.insert(activities).values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          entityType: 'quote',
          entityId: quoteId,
          contactId: quote.contactId,
          dealId: quote.dealId ?? null,
          eventType: 'offer_cancelled',
          description: `Offer "${quote.title}" cancelled`,
          metadata: { offer_id: quoteId },
        });
      }
    });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'offer_cancelled',
      entityType: 'quote',
      entityId: quoteId,
    });

    return NextResponse.json({ ok: true, status: 'cancelled' });
  } catch (err) {
    // #3159: lost the race — the offer went terminal under us. 409, unchanged
    // row, no activity written.
    if (err instanceof OfferTransitionLost) {
      return NextResponse.json({ error: 'Cannot cancel offer in its current state' }, { status: 409 });
    }
    return apiError(err);
  }
});
