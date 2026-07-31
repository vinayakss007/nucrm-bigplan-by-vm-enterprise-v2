import { apiError } from '@/lib/api-error';
/**
 * Resend Email Webhook Handler
 * Handles bounce, complaint, and delivery events from Resend.
 * On bounce/complaint: sets doNotContact=true on the contact.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { contacts, sequenceEnrollments, activities } from '@/drizzle/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    
    // Optional: Verify webhook secret if configured
    const urlSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (urlSecret) {
      const providedSecret = req.headers.get('x-webhook-secret');
      if (!providedSecret || providedSecret !== urlSecret) {
        return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
      }
    }

    const event = JSON.parse(body) as { 
      type: string; 
      data: { 
        email_id?: string; 
        to?: string[]; 
        from?: string;
        created_at: string;
      } 
    };
    
    const email = event.data?.to?.[0]?.toLowerCase() ?? null;

    switch (event.type) {
      case 'email.bounced':
      case 'email.complained': {
        if (email) {
          // Steps 1 and 2 stay atomic with each other: a contact flagged
          // do-not-contact whose enrollments were left active would carry on
          // sending, so the flag and the cancellation must land together.
          const affectedContacts = await db.transaction(async (tx) => {
            // 1. Find and update contacts
            const updatedContacts = await tx
              .update(contacts)
              .set({ 
                doNotContact: true, 
                updatedAt: new Date() 
              })
              .where(and(
                eq(contacts.email, email),
                eq(contacts.doNotContact, false),
                isNull(contacts.deletedAt)
              ))
              .returning({ 
                id: contacts.id, 
                tenantId: contacts.tenantId, 
                firstName: contacts.firstName 
              });

            if (updatedContacts.length > 0) {
              const contactIds = updatedContacts.map(c => c.id);

              // 2. Cancel active sequence enrollments
              await tx
                .update(sequenceEnrollments)
                .set({ 
                  status: 'cancelled',
                  updatedAt: new Date()
                })
                .where(and(
                  inArray(sequenceEnrollments.contactId, contactIds),
                  eq(sequenceEnrollments.status, 'active')
                ));
            }

            return updatedContacts;
          });

          if (affectedContacts.length > 0) {
            console.log(`[resend-webhook] ${event.type}: ${affectedContacts.length} contact(s) marked DNC for ${email}`);

            // 3. Log activities — deliberately AFTER the commit above and
            // non-fatal. This insert used to run inside the transaction with a
            // `type: 'note'` key; `activities` has no `type` column, so Drizzle
            // dropped it and the NOT NULL `event_type` was never supplied. The
            // resulting constraint violation aborted the transaction, undoing
            // the do-not-contact flag and the enrollment cancellation on every
            // single bounce and complaint. Suppressing a bounce is the
            // compliance-critical part; the activity row is bookkeeping, so a
            // future failure here is logged and nothing is rolled back.
            const activityInserts = affectedContacts.map(contact => ({
              tenantId: contact.tenantId,
              contactId: contact.id,
              eventType: 'note',
              description: event.type === 'email.bounced'
                ? `Email bounced — do not contact flag set automatically`
                : `Email complaint received — do not contact flag set automatically`,
              entityType: 'contact',
              entityId: contact.id,
              action: event.type
            }));

            try {
              await db.insert(activities).values(activityInserts);
            } catch (activityErr) {
              await logError({ error: activityErr, context: 'resend-webhook:activity-log' });
            }
          }
        }
        break;
      }
      case 'email.delivered':
        // Optional: track delivery in email_log if needed
        break;
      default:
        console.log(`[resend-webhook] Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'resend-webhook' });
    return apiError(err);
  }
}
