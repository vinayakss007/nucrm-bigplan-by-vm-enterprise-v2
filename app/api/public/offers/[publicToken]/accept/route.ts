/**
 * Buyer accepts an offer
 *
 *   POST /api/public/offers/[publicToken]/accept
 *   body: { email?: string, signature?: string }
 *
 * No auth — the token IS the credential. Rate-limited.
 *
 * On accept:
 *   - status → 'accepted'
 *   - acceptedAt set
 *   - metadata.offer.accepted_by_email + accepted_at recorded
 *   - activities row of `eventType='offer_accepted'`
 *   - audit log entry
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
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const offerAcceptSchema = z.object({
  email: z.string().email().max(200).optional().nullable(),
  signature: z.string().max(200).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ publicToken: string }> }) {
  try {
    const limited = await checkRateLimit(req, { action: 'public_offer_accept', max: 5, windowMinutes: 60 });
    if (limited) return limited;

    const { publicToken } = await params;
    const offer = await findOfferByToken(publicToken);
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    if (!canTransition(offer.status ?? '', 'accepted')) {
      return NextResponse.json({ error: 'Offer cannot be accepted in its current state' }, { status: 409 });
    }
    if (offer.expiresAt && new Date(offer.expiresAt).getTime() < Date.now()) {
      await db.update(quotes).set({ status: 'expired', updatedAt: new Date() }).where(eq(quotes.id, offer.id));
      return NextResponse.json({ error: 'Offer has expired' }, { status: 410 });
    }

    let raw;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const parsed = validateBody(offerAcceptSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const email = parsed.data.email?.trim() ?? null;
    const signature = parsed.data.signature?.trim() ?? null;

    const now = new Date();
    await db
      .update(quotes)
      .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
      .where(eq(quotes.id, offer.id));

    await patchOfferMetadata(offer.id, offer.tenantId, {
      accepted_by_email: email ?? undefined,
      accepted_at: now.toISOString(),
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
          eventType: 'offer_accepted',
          description: `Buyer accepted offer "${offer.title}"`,
          metadata: { offer_id: offer.id, total_amount: offer.totalAmount, accepted_by_email: email, signature },
        });
      } catch (err) {
        console.warn('[offers/accept] activity insert failed:', (err as Error).message);
      }
    }

    await logAudit({
      tenantId: offer.tenantId,
      action: 'offer_accepted',
      entityType: 'quote',
      entityId: offer.id,
      newData: { accepted_by_email: email },
    });

    return NextResponse.json({ ok: true, status: 'accepted', accepted_at: now.toISOString() });
  } catch (err) {
    return apiError(err);
  }
}
