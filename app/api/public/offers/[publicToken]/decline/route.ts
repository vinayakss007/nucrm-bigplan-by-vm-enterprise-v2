/**
 * Buyer declines an offer
 *
 *   POST /api/public/offers/[publicToken]/decline
 *   body: { reason?: string, email?: string }
 *
 * No auth — the token IS the credential. Rate-limited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { quotes, activities } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import {
  findOfferByToken,
  patchOfferMetadata,
  canTransition,
} from '@/lib/offers';

export async function POST(req: NextRequest, { params }: { params: Promise<{ publicToken: string }> }) {
  try {
    const limited = await checkRateLimit(req, { action: 'public_offer_decline', max: 5, windowMinutes: 60 });
    if (limited) return limited;

    const { publicToken } = await params;
    const offer = await findOfferByToken(publicToken);
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    if (!canTransition(offer.status ?? '', 'declined')) {
      return NextResponse.json({ error: 'Offer cannot be declined in its current state' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : null;

    const now = new Date();
    await db
      .update(quotes)
      .set({ status: 'declined', declinedAt: now, updatedAt: now })
      .where(eq(quotes.id, offer.id));

    await patchOfferMetadata(offer.id, offer.tenantId, {
      decline_reason: reason || undefined,
      declined_at: now.toISOString(),
    });

    if (offer.contactId) {
      try {
        await db.insert(activities).values({
          tenantId: offer.tenantId,
          userId: null,
          entityType: 'quote',
          entityId: offer.id,
          contactId: offer.contactId,
          dealId: offer.dealId ?? null,
          eventType: 'offer_declined',
          description: `Buyer declined offer "${offer.title}"${reason ? ` — ${reason}` : ''}`,
          metadata: { offer_id: offer.id, decline_reason: reason, email },
        });
      } catch (err) {
        console.warn('[offers/decline] activity insert failed:', (err as Error).message);
      }
    }

    await logAudit({
      tenantId: offer.tenantId,
      action: 'offer_declined',
      entityType: 'quote',
      entityId: offer.id,
      newData: { reason, email },
    });

    return NextResponse.json({ ok: true, status: 'declined', declined_at: now.toISOString() });
  } catch (err) {
    return apiError(err);
  }
}
