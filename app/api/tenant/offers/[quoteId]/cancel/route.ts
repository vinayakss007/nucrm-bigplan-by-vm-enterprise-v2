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
import { canTransition } from '@/lib/offers';

export async function POST(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
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

    // Clear the public token so the buyer link is dead, set status
    await db
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
      .where(eq(quotes.id, quoteId));

    if (quote.contactId) {
      try {
        await db.insert(activities).values({
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
      } catch (err) {
        console.warn('[offers/cancel] activity insert failed:', (err as Error).message);
      }
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
}
