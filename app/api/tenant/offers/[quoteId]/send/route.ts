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
import {
  generatePublicToken,
  publicOfferUrl,
  patchOfferMetadata,
  readOfferMetadata,
  canTransition,
} from '@/lib/offers';

interface SendBody {
  to_email?: string;
  expires_at?: string;
  message?: string;
}

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

    if (!canTransition(quote.status ?? 'draft', 'sent')) {
      return NextResponse.json({
        error: `Cannot send offer in '${quote.status}' state`,
      }, { status: 409 });
    }

    const body = (await req.json().catch(() => ({}))) as SendBody;
    const meta = readOfferMetadata(quote);
    const publicToken = meta.public_token || generatePublicToken();

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

    // Persist the lifecycle change
    await db
      .update(quotes)
      .set({
        status: 'sent',
        sentAt: new Date(),
        ...(expiresAt ? { expiresAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId));

    await patchOfferMetadata(quoteId, ctx.tenantId, {
      public_token: publicToken,
      sent_to_email: toEmail,
    });

    // Activity row so the timeline reflects it
    if (quote.contactId) {
      try {
        await db.insert(activities).values({
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
      } catch (err) {
        console.warn('[offers/send] activity insert failed:', (err as Error).message);
      }
    }

    // Outbound email — non-fatal if it fails
    const link = publicOfferUrl(publicToken);
    let emailResult: { success: boolean; provider?: string; error?: string } | null = null;
    try {
      emailResult = await sendEmail({
        to: toEmail,
        subject: `Your offer: ${quote.title}`,
        html: `
          <p>Hi ${contactName},</p>
          <p>Your offer for <strong>${quote.title}</strong> is ready to review.</p>
          ${body.message ? `<p>${body.message}</p>` : ''}
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
    console.error('[offers/send POST]', err);
    return apiError(err);
  }
}
