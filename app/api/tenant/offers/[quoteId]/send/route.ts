/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Send an offer (transitions a quote into a buyer-facing offer)
 *
 *   POST /api/tenant/offers/[quoteId]/send
 *   body: { to_email?, expires_at?, message? }
 *
 * - Issues a public_token if missing (so resend keeps the same URL).
 * - status: draft → sent (or sent → sent for resend).
 * - Writes activities row of `eventType='offer_sent'` so it lands on the
 *   contact timeline.
 * - Sends an email if `RESEND_API_KEY` / `SMTP_HOST` is configured (otherwise
 *   logs to console — same fallback the rest of the email pipe uses).
 *
 * Returns { public_url, public_token, status } so the seller UI can render
 * the link immediately.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { quotes, contacts, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email/service';
import { sanitizeHTMLServer } from '@/lib/sanitize';
import {
  generatePublicToken,
  publicOfferUrl,
  patchOfferMetadata,
  readOfferMetadata,
  canTransition,
  transitionOfferStatus,
  OfferTransitionLost,
} from '@/lib/offers';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

interface SendBody {
  to_email?: string;
  expires_at?: string;
  message?: string;
}

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

    if (!canTransition(quote.status ?? 'draft', 'sent')) {
      return NextResponse.json({
        error: `Cannot send offer in '${quote.status}' state`,
      }, { status: 409 });
    }

    let body: SendBody;
    try { body = await readJsonBody(req) as SendBody; } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    // #3159: the public_token is chosen after the guarded status update wins
    // (below) — minting it from this unlocked read let two concurrent sends
    // generate two tokens and have the later jsonb merge kill the first link.
    let publicToken = '';

    // Resolve buyer email — explicit body wins, then contact lookup
    let toEmail = body.to_email?.trim() || null;
    let contactName = 'there';
    if (quote.contactId) {
      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.id, quote.contactId),
        columns: { firstName: true, lastName: true, email: true },
      });
      if (!toEmail && contact?.email) toEmail = contact.email;
      if (contact?.firstName) contactName = contact.firstName;
    }
    if (!toEmail) {
      return NextResponse.json({ error: 'Buyer email required (provide to_email or attach a contact)' }, { status: 400 });
    }

    // Validate expires_at if provided
    let expiresAt: Date | undefined;
    if (body.expires_at) {
      const parsed = new Date(body.expires_at);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'expires_at must be a valid ISO date' }, { status: 400 });
      }
      if (parsed.getTime() < Date.now()) {
        return NextResponse.json({ error: 'expires_at cannot be in the past' }, { status: 400 });
      }
      expiresAt = parsed;
    }

    // Persist the lifecycle change: status + metadata (public_token/sent_to_email)
    // + timeline activity all in one db.transaction so the offer is never marked
    // 'sent' without its public_token metadata (H7). patchOfferMetadata now takes
    // the tx; the activity write participates so a failed timeline row rolls the
    // send back rather than leaving a half-sent offer.
    //
    // #3159: the status write is conditional — it only lands from draft/sent,
    // the set canTransition() vetted against the pre-tx read. If a concurrent
    // cancel/accept committed in between, zero rows come back, this throws, and
    // the metadata + activity writes roll back instead of overwriting the
    // terminal state (and no email goes out below).
    await db.transaction(async (tx) => {
      const won = await transitionOfferStatus(tx, quoteId, ['draft', 'sent'], {
        status: 'sent',
        sentAt: new Date(),
        ...(expiresAt ? { expiresAt } : {}),
        updatedAt: new Date(),
      });
      if (!won) throw new OfferTransitionLost('sent');

      // Re-read the metadata under the lock the guarded update just took: a
      // concurrent send that committed contributes its token here instead of
      // being clobbered by a freshly minted one.
      const [fresh] = await tx
        .select({ metadata: quotes.metadata })
        .from(quotes)
        .where(eq(quotes.id, quoteId));
      publicToken = readOfferMetadata({ metadata: fresh?.metadata ?? null }).public_token || generatePublicToken();

      await patchOfferMetadata(quoteId, ctx.tenantId, {
        public_token: publicToken,
        sent_to_email: toEmail,
      }, tx);

      // Activity row so the timeline reflects it
      if (quote.contactId) {
        await tx.insert(activities).values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          entityType: 'quote',
          entityId: quoteId,
          contactId: quote.contactId,
          dealId: quote.dealId ?? null,
          eventType: 'offer_sent',
          description: `Offer "${quote.title}" sent to ${toEmail}`,
          metadata: {
            offer_id: quoteId,
            quote_number: quote.quoteNumber,
            total_amount: quote.totalAmount,
            to_email: toEmail,
          },
        });
      }
    });

    // Outbound email — non-fatal if it fails
    const link = publicOfferUrl(publicToken);
    const safeContactName = sanitizeHTMLServer(contactName || '');
    const safeQuoteTitle = sanitizeHTMLServer(quote.title || '');
    let emailResult: { success: boolean; provider?: string; error?: string } | null = null;
    try {
      emailResult = await sendEmail({
        to: toEmail,
        subject: `Your offer: ${quote.title}`,
        html: `
          <p>Hi ${safeContactName},</p>
          <p>Your offer for <strong>${safeQuoteTitle}</strong> is ready to review.</p>
          ${body.message ? `<p>${sanitizeHTMLServer(body.message)}</p>` : ''}
          <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">View offer</a></p>
          <p style="color:#6b7280;font-size:13px;margin-top:24px">If the button doesn't work, paste this link into your browser:<br/>${link}</p>
        `,
        text: `Your offer "${quote.title}" is ready to review: ${link}`,
      });
    } catch (err) {
      console.warn('[offers/send] email send threw:', (err as Error).message);
      emailResult = { success: false, error: (err as Error).message };
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'offer_sent',
      entityType: 'quote',
      entityId: quoteId,
      newData: { to_email: toEmail, public_token: publicToken, email_result: emailResult },
    });

    return NextResponse.json({
      ok: true,
      status: 'sent',
      public_token: publicToken,
      public_url: link,
      to_email: toEmail,
      email: emailResult,
    });
  } catch (err) {
    // #3159: lost the race — the offer moved to a state that cannot be sent
    // (buyer accepted, another cancel won). Client-actionable conflict, not a
    // server fault: answer 409 without paging logError or emailing anyone.
    if (err instanceof OfferTransitionLost) {
      return NextResponse.json({ error: 'Cannot send offer in its current state' }, { status: 409 });
    }
    await logError({ error: err, context: 'offers/send POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
