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
  const sequenceId = searchParams.get('seq');

  if (!contactId) {
    return new NextResponse('Missing contact parameter', { status: 400 });
  }

  try {
    // Set do_not_contact
    const [contact] = await db.update(contacts)
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

    if (!contact) {
      return new NextResponse('Contact not found', { status: 404 });
    }

    // Cancel all sequence enrollments for this contact
    await db.update(sequenceEnrollments)
      .set({ status: 'cancelled' })
      .where(and(
        eq(sequenceEnrollments.contactId, contactId), 
        eq(sequenceEnrollments.status, 'active')
      ));

    // Log activity
    await db.insert(activities).values({
      tenantId: contact.tenantId,
      contactId: contactId,
      eventType: 'note',
      description: 'Unsubscribed via email link — do not contact flag set',
      entityType: 'contact',
      entityId: contactId,
      action: 'unsubscribe'
    }).catch(() => {});

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
  } catch (err: any) {
    console.error('[Unsubscribe] Error:', err);
    return new NextResponse('Something went wrong. Please contact support.', { status: 500 });
  }
}
