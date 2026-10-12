/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Buyer declines an offer
 *
 *   POST /api/public/offers/[publicToken]/decline
 *   body: { reason?: string, email?: string }
 *
 * No auth — the token IS the credential. Rate-limited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { quotes, activities } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';
import {
  findOfferByToken,
  patchOfferMetadata,
  canTransition,
} from '@/lib/offers';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';

const offerDeclineSchema = z.object({
  reason: z.string().max(500).optional().default(''),
  email: z.string().email().max(200).optional().nullable(),
});

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

    let raw;
    try { raw = await readJsonBody(req); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const parsed = validateBody(offerDeclineSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const reason = (parsed.data.reason ?? '').trim();
    const email = parsed.data.email?.trim() ?? null;

    const now = new Date();
    // Persist the lifecycle change: status + metadata + timeline activity all in
    // one transaction so the offer is never marked 'declined' without its decline
    // metadata (H7). patchOfferMetadata takes the tx; the activity write
    // participates so a failed timeline row rolls the decline back.
    //
    // #2468: that transaction also has to NAME a workspace. `quotes` and
    // `activities` are tenant-policyed and this is an unauthenticated route with
    // no tenant carrier, so the bare `db.transaction()` set no GUCs at all — the
    // writes were as unreachable as the credential read in lib/offers.ts. The
    // context comes from the resolved offer row, never from the request.
    await withTenantContext(offer.tenantId, NO_USER_SENTINEL, async (tx) => {
      await tx
        .update(quotes)
        .set({ status: 'declined', declinedAt: now, updatedAt: now })
        .where(eq(quotes.id, offer.id));

      await patchOfferMetadata(offer.id, offer.tenantId, {
        decline_reason: reason || undefined,
        declined_at: now.toISOString(),
      }, tx);

      if (offer.contactId) {
        await tx.insert(activities).values({
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
      }
    });

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
