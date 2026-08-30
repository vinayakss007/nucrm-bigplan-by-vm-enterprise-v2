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
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { contacts, sequenceEnrollments, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';

/**
 * Perform the unsubscribe side effects for a contact: set the do-not-contact /
 * unsubscribed flags, cancel active sequence enrollments, and log an activity.
 * Returns the updated contact tuple (empty when the contact does not exist).
 *
 * The HMAC token MUST already be verified by the caller before this runs.
 */
async function unsubscribeContact(contactId: string) {
  return db.transaction(async (tx) => {
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
        firstName: contacts.firstName,
        tenantId: contacts.tenantId
      });

    // Return an empty tuple, not null: the caller destructures this value
    // with `const [contact] = ...`, and destructuring null throws a
    // TypeError that the outer catch turns into a 500 — making the intended
    // 404 "Contact not found" response below unreachable.
    if (!c) return [];

    await tx.update(sequenceEnrollments)
      .set({ status: 'cancelled' })
      .where(and(
        eq(sequenceEnrollments.contactId, contactId),
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

    return [c];
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
    const [contact] = await unsubscribeContact(contactId);

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
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

