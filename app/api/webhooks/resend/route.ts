import { apiError } from '@/lib/api-error';
/**
 * Resend Email Webhook Handler
 * Handles bounce, complaint, and delivery events from Resend.
 * Hard bounces (permanent): sets doNotContact=true immediately.
 * Soft bounces (temporary): tracked with bounceCount metadata; DNC after 3 within 7 days.
 * Complaints: sets doNotContact=true immediately.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { contacts, sequenceEnrollments, activities } from '@/drizzle/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';

/** Soft bounce threshold: DNC after this many soft bounces within the window */
const SOFT_BOUNCE_THRESHOLD = 3;
/** Window in days for soft bounce threshold */
const SOFT_BOUNCE_WINDOW_DAYS = 7;

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
        bounce_type?: string; // 'hard' | 'soft' - if available from Resend
      } 
    };
    
    const email = event.data?.to?.[0]?.toLowerCase() ?? null;

    switch (event.type) {
      case 'email.bounced': {
        if (!email) break;
        
        // Determine if this is a hard or soft bounce
        // Resend may provide bounce_type in data; default to hard for safety
        const bounceType = event.data.bounce_type === 'soft' ? 'soft' : 'hard';

        if (bounceType === 'hard') {
          // Hard bounce: immediately set doNotContact
          await handleHardBounce(email, event.type);
        } else {
          // Soft bounce: track and escalate after threshold
          await handleSoftBounce(email);
        }
        break;
      }
      case 'email.complained': {
        if (email) {
          // Complaints always immediately DNC
          await handleHardBounce(email, event.type);
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

/**
 * Handle a hard bounce or complaint: immediately set doNotContact=true
 * and cancel active sequence enrollments.
 */
async function handleHardBounce(email: string, eventType: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Find and update contacts
    const affectedContacts = await tx
      .update(contacts)
      .set({ 
        doNotContact: true,
        metadata: sql`jsonb_set(
          COALESCE(${contacts.metadata}, '{}'::jsonb),
          '{bounceType}',
          '"hard"'
        ) || jsonb_build_object('lastBounceAt', ${new Date().toISOString()})`,
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

    if (affectedContacts.length > 0) {
      const contactIds = affectedContacts.map(c => c.id);

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

      // 3. Log activities
      const activityInserts = affectedContacts.map(contact => ({
        tenantId: contact.tenantId,
        contactId: contact.id,
        type: 'note',
        description: eventType === 'email.bounced'
          ? `Hard bounce detected - do not contact flag set automatically`
          : `Email complaint received - do not contact flag set automatically`,
        entityType: 'contact',
        entityId: contact.id,
        action: eventType
      }));

      await tx.insert(activities).values(activityInserts as unknown as typeof activities.$inferInsert[]);
      
      console.log(`[resend-webhook] ${eventType} (hard): ${affectedContacts.length} contact(s) marked DNC for ${email}`);
    }
  });
}

/**
 * Handle a soft bounce: increment bounce counter in metadata and escalate
 * to doNotContact after SOFT_BOUNCE_THRESHOLD bounces within the window.
 */
async function handleSoftBounce(email: string): Promise<void> {
  // Fetch contacts with this email
  const matchingContacts = await db
    .select({ id: contacts.id, tenantId: contacts.tenantId, metadata: contacts.metadata })
    .from(contacts)
    .where(and(
      eq(contacts.email, email),
      eq(contacts.doNotContact, false),
      isNull(contacts.deletedAt)
    ));

  if (matchingContacts.length === 0) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - SOFT_BOUNCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  for (const contact of matchingContacts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (contact.metadata as any) || {};
    const bounces: string[] = Array.isArray(meta.softBounces) ? meta.softBounces : [];
    
    // Filter to only bounces within the window
    const recentBounces = bounces.filter(ts => new Date(ts) >= windowStart);
    recentBounces.push(now.toISOString());

    const newCount = recentBounces.length;
    const shouldDnc = newCount >= SOFT_BOUNCE_THRESHOLD;

    if (shouldDnc) {
      // Escalate to DNC
      await db.transaction(async (tx) => {
        await tx
          .update(contacts)
          .set({
            doNotContact: true,
            metadata: sql`jsonb_set(
              jsonb_set(
                COALESCE(${contacts.metadata}, '{}'::jsonb),
                '{bounceType}', '"soft_escalated"'
              ),
              '{softBounces}', ${JSON.stringify(recentBounces)}::jsonb
            ) || jsonb_build_object('lastBounceAt', ${now.toISOString()}, 'bounceCount', ${newCount})`,
            updatedAt: now,
          })
          .where(eq(contacts.id, contact.id));

        // Cancel enrollments
        await tx
          .update(sequenceEnrollments)
          .set({ status: 'cancelled', updatedAt: now })
          .where(and(
            eq(sequenceEnrollments.contactId, contact.id),
            eq(sequenceEnrollments.status, 'active')
          ));

        await tx.insert(activities).values({
          tenantId: contact.tenantId,
          contactId: contact.id,
          type: 'note',
          description: `Soft bounce threshold reached (${newCount} within ${SOFT_BOUNCE_WINDOW_DAYS} days) - do not contact flag set automatically`,
          entityType: 'contact',
          entityId: contact.id,
          action: 'email.soft_bounce_escalated'
        } as unknown as typeof activities.$inferInsert);
      });

      console.log(`[resend-webhook] Soft bounce escalated to DNC for contact ${contact.id} (${newCount} bounces)`);
    } else {
      // Just track the soft bounce
      await db
        .update(contacts)
        .set({
          metadata: sql`jsonb_set(
            jsonb_set(
              COALESCE(${contacts.metadata}, '{}'::jsonb),
              '{bounceType}', '"soft"'
            ),
            '{softBounces}', ${JSON.stringify(recentBounces)}::jsonb
          ) || jsonb_build_object('lastBounceAt', ${now.toISOString()}, 'bounceCount', ${newCount})`,
          updatedAt: now,
        })
        .where(eq(contacts.id, contact.id));

      console.log(`[resend-webhook] Soft bounce tracked for contact ${contact.id} (${newCount}/${SOFT_BOUNCE_THRESHOLD})`);
    }
  }
}
