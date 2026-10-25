/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * One-click unsubscribe endpoint
 * GET/POST /api/unsubscribe?contact=uuid&token=hmac[&seq=uuid]
 * Sets do_not_contact=true and cancels sequence enrollment.
 *
 * #1169: the HMAC `token` is REQUIRED and verified (constant-time) before any
 * mutation, so a contact UUID alone cannot be used to unsubscribe someone.
 * GET serves an HTML confirmation page; POST implements RFC 8058 one-click.
 *
 * #3237: verifying the token was never the problem — the write it authorised was
 * invisible to RLS. `contacts` is FORCE-RLS and its only arm keys on
 * `app.current_tenant`, which an anonymous mail client does not have, so the
 * handler's `UPDATE … RETURNING` matched zero rows and a valid link answered 404
 * for a contact that exists while leaving it subscribed. The claim now runs inside
 * `withUnsubscribeContactContext` (migration 0138), which names the verified
 * contact id to a SELECT + UPDATE arm pair whose WITH CHECK admits only the
 * opt-out flags; the tenant comes back on the claimed row and the enrollment and
 * activity writes run under `tenant_isolation` from there.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { contacts, sequenceEnrollments, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { withUnsubscribeContactContext, setUnsubscribeTenantContext } from '@/lib/db/unsubscribe-contact-context';

/**
 * Perform the unsubscribe side effects for a contact: set the do-not-contact /
 * unsubscribed flags, cancel active sequence enrollments, and log an activity.
 * Returns the updated contact, or null when the contact does not exist.
 *
 * The HMAC token MUST already be verified by the caller before this runs — it is
 * what earns the row-level claim this opens, and nothing here re-checks it.
 */
async function unsubscribeContact(contactId: string) {
  return withUnsubscribeContactContext(contactId, async (tx) => {
    const [c] = await tx.update(contacts)
      .set({
        doNotContact: true,
        // #1120: also set the dedicated unsubscribed flag so email/sequence
        // sends that gate on `unsubscribed` honor the opt-out (CAN-SPAM/GDPR).
        unsubscribed: true,
        updatedAt: new Date()
      })
      .where(and(
        eq(contacts.id, contactId),
        isNull(contacts.deletedAt)
      ))
      .returning({
        id: contacts.id,
        tenantId: contacts.tenantId
      });

    if (!c) return null;
    // The claim above is the only pre-auth privilege in this request, and it ends
    // here: this statement names the workspace the claimed row belongs to and
    // clears the claim GUC in the same round trip, so the two writes below are
    // admitted by the tenant policy they have always been under (#3237).
    await setUnsubscribeTenantContext(tx, c.tenantId);

    await tx.update(sequenceEnrollments)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(sequenceEnrollments.contactId, contactId),
        // #2402: the contact row this transaction just updated carries its tenant,
        // so the enrollment write is scoped by it instead of relying on the contact
        // uuid being globally unique — the pattern #2383 established for writes.
        eq(sequenceEnrollments.tenantId, c.tenantId),
        eq(sequenceEnrollments.status, 'active')
      ));

    await tx.insert(activities).values({
      tenantId: c.tenantId,
      contactId: contactId,
      eventType: 'note',
      description: 'Unsubscribed via email link — do not contact flag set',
      entityType: 'contact',
      entityId: contactId,
      action: 'unsubscribe'
    });

    return c;
  });
}

const UNSUBSCRIBED_HTML =
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
  <style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#374151}
  h1{color:#059669}p{color:#6b7280;margin-top:8px}</style></head>
  <body><h1>✓ Unsubscribed</h1>
  <p>You've been unsubscribed and won't receive further emails from this sequence.</p>
  <p style="margin-top:24px;font-size:13px">You can safely close this page.</p>
  </body></html>`;

async function handleUnsubscribe(req: NextRequest, htmlResponse: boolean) {
  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get('contact');
  const token = searchParams.get('token');

  if (!contactId) {
    return new NextResponse('Missing contact parameter', { status: 400 });
  }

  // Require and verify the HMAC token before mutating anything. Without this,
  // anyone who knows/guesses a contact UUID could unsubscribe them. Comparison
  // is constant-time inside verifyUnsubscribeToken.
  if (!verifyUnsubscribeToken(contactId, token)) {
    return new NextResponse('Invalid or missing unsubscribe token', { status: 403 });
  }

  try {
    const contact = await unsubscribeContact(contactId);

    if (!contact) {
      return new NextResponse('Contact not found', { status: 404 });
    }

    if (!htmlResponse) {
      // RFC 8058 List-Unsubscribe-Post one-click: mail clients expect a 200
      // with no body requirement.
      return new NextResponse(null, { status: 200 });
    }

    return new NextResponse(UNSUBSCRIBED_HTML, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (err) {
    void logError({ error: err, context: 'unsubscribe' });
    return new NextResponse('Something went wrong. Please contact support.', { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleUnsubscribe(req, true);
}

// RFC 8058 List-Unsubscribe-Post one-click unsubscribe. Mail clients POST here
// with `List-Unsubscribe=One-Click`; the same token verification applies.
export async function POST(req: NextRequest) {
  return handleUnsubscribe(req, false);
}

