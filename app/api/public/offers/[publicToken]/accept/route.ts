/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
import { activities } from '@/drizzle/schema';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';
import {
  findOfferByToken,
  patchOfferMetadata,
  canTransition,
  transitionOfferStatus,
} from '@/lib/offers';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';

const offerAcceptSchema = z.object({
  email: z.string().email().max(200).optional().nullable(),
  signature: z.string().max(200).optional().nullable(),
});

/**
 * What the one transaction decided, mapped to a response outside the RLS context
 * (#2446's K2 rule). Before #2468 these branches returned `NextResponse` from
 * inside a bare `db.transaction()`, so a pool connection could be handed to the
 * next request mid-accept; now they are data.
 */
type AcceptOutcome =
  | { kind: 'expired' }
  | { kind: 'lost' }
  | { kind: 'accepted'; acceptedAt: Date };

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

    let raw;
    try { raw = await readJsonBody(req); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const parsed = validateBody(offerAcceptSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const email = parsed.data.email?.trim() ?? null;
    const signature = parsed.data.signature?.trim() ?? null;

    // #2468: `quotes` and `activities` are both tenant-policyed and this handler
    // named no workspace for either — the expire write ran on the bare pool and
    // the accept wrote through a transaction with no GUCs. The whole lifecycle
    // write is now one transaction scoped to the tenant the credential resolved.
    // #2446's sibling (`app/api/public/quotes/[id]/accept`) is the shape copied.
    const outcome = await withTenantContext(offer.tenantId, NO_USER_SENTINEL, async (tx): Promise<AcceptOutcome> => {
      // #3159: both writes are conditional on the offer still being in a
      // source state this transition (or the auto-expire) is allowed to
      // leave. The status read above is unlocked, so a concurrent cancel/
      // expire can have committed first — matching zero rows then reports
      // 'lost' instead of overwriting a terminal state, and the metadata +
      // activity writes below never run.
      if (offer.expiresAt && new Date(offer.expiresAt).getTime() < Date.now()) {
        const won = await transitionOfferStatus(tx, offer.id, ['sent', 'viewed'], { status: 'expired', updatedAt: new Date() });
        return won ? { kind: 'expired' } : { kind: 'lost' };
      }

      const now = new Date();
      const won = await transitionOfferStatus(tx, offer.id, ['sent', 'viewed'], {
        status: 'accepted',
        acceptedAt: now,
        updatedAt: now,
      });
      if (!won) return { kind: 'lost' };

      // One jsonb merge through patchOfferMetadata instead of the second inline
      // jsonb_set this route used to run: same merge semantics as decline, and it
      // scopes the write to (id, tenantId) rather than to the id alone.
      await patchOfferMetadata(offer.id, offer.tenantId, {
        accepted_by_email: email ?? undefined,
        accepted_at: now.toISOString(),
      }, tx);

      if (offer.contactId) {
        await tx.insert(activities).values({
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
      }

      return { kind: 'accepted', acceptedAt: now };
    });

    if (outcome.kind === 'expired') return NextResponse.json({ error: 'Offer has expired' }, { status: 410 });
    // #3159: someone else wrote a terminal status between our read and the
    // guarded update — the accept did not happen, and must not look like it did.
    if (outcome.kind === 'lost') {
      return NextResponse.json({ error: 'Offer cannot be accepted in its current state' }, { status: 409 });
    }

    await logAudit({
      tenantId: offer.tenantId,
      action: 'offer_accepted',
      entityType: 'quote',
      entityId: offer.id,
      newData: { accepted_by_email: email },
    });

    return NextResponse.json({ ok: true, status: 'accepted', accepted_at: outcome.acceptedAt.toISOString() });
  } catch (err) {
    return apiError(err);
  }
}
