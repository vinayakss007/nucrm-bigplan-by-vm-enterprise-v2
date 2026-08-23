/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * One-click unsubscribe endpoint
 * GET /api/unsubscribe?contact=uuid&seq=uuid
 * Sets do_not_contact=true and cancels sequence enrollment
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { contacts, sequenceEnrollments, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contactId  = searchParams.get('contact');
  const _sequenceId = searchParams.get('seq');

  if (!contactId) {
    return new NextResponse('Missing contact parameter', { status: 400 });
  }

  try {
    const [contact] = await db.transaction(async (tx) => {
      const [c] = await tx.update(contacts)
        .set({ 
          doNotContact: true, 
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

    if (!contact) {
      return new NextResponse('Contact not found', { status: 404 });
    }

    // Return a clean HTML page
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
      <style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#374151}
      h1{color:#059669}p{color:#6b7280;margin-top:8px}</style></head>
      <body><h1>✓ Unsubscribed</h1>
      <p>You've been unsubscribed and won't receive further emails from this sequence.</p>
      <p style="margin-top:24px;font-size:13px">You can safely close this page.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Unsubscribe] Error:', err);
    return new NextResponse('Something went wrong. Please contact support.', { status: 500 });
  }
}
