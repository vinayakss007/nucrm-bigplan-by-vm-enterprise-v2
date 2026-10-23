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
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { canTransition, allowedFromStatus } from '@/lib/offers';
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
    // #3159 — the `canTransition` check above reads a row that can change before
    // this UPDATE does, and an id-only write then overwrote whatever it became:
    // buyer accepts, seller's cancel (which had already passed the check on a
    // `sent` read) lands second and the accepted offer is simply gone. Postgres
    // re-evaluates the WHERE against the locked row version, so carrying the
    // transition's from-set into the write makes the loser fail here instead of
    // silently winning, and `returning()` is how the handler finds that out.
    const cancelled = await db.transaction(async (tx) => {
      const [won] = await tx
        .update(quotes)
        .set({
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
        })
        .where(and(
          eq(quotes.id, quoteId),
          eq(quotes.tenantId, ctx.tenantId),
          inArray(quotes.status, allowedFromStatus('cancelled')),
        ))
        .returning({ id: quotes.id });
      if (!won) return false;

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
      return true;
    });

    // Nothing was written and no audit row was filed: the offer moved on while
    // this request was deciding. Same 409 the stale check answers, same body.
    if (!cancelled) {
      return NextResponse.json({ error: "Cannot cancel an offer in its current state" }, { status: 409 });
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'offer_cancelled',
      entityType: 'quote',
      entityId: quoteId,
    });

    return NextResponse.json({ ok: true, status: 'cancelled' });
  } catch (err) {
    return apiError(err);
  }
});
