/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
/**
 * Resend Email Webhook Handler
 * Handles bounce, complaint, and delivery events from Resend.
 * Hard bounces (permanent): sets doNotContact=true immediately.
 * Soft bounces (temporary): tracked with bounceCount metadata; DNC after 3 within 7 days.
 * Complaints: sets doNotContact=true immediately.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, createHmac } from 'crypto';
import { db } from '@/drizzle/db';
import { contacts, sequenceEnrollments, activities } from '@/drizzle/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';
import { checkRateLimit } from '@/lib/rate-limit';

const VALID_RESEND_EVENT_TYPES = [
  'email.bounced',
  'email.complained',
  'email.delivered',
  'email.sent',
  'email.opened',
  'email.clicked',
  'email.replied',
];

/** Soft bounce threshold: DNC after this many soft bounces within the window */
const SOFT_BOUNCE_THRESHOLD = 3;
/** Window in days for soft bounce threshold */
const SOFT_BOUNCE_WINDOW_DAYS = 7;

/** Svix signature timestamp tolerance (seconds). */
const SVIX_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verify a Svix-signed webhook (Resend's mechanism).
 *
 * Headers: `svix-id`, `svix-timestamp`, `svix-signature`.
 * Signed content: `${svix-id}.${svix-timestamp}.${body}`.
 * Signature: base64 HMAC-SHA256 keyed by the secret bytes (the portion after
 * the `whsec_` prefix, base64-decoded). `svix-signature` may contain multiple
 * space-separated `v1,<sig>` entries; any match is accepted (constant-time).
 */
function verifySvixSignature(req: NextRequest, body: string, secret: string): boolean {
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Enforce timestamp tolerance to prevent replay.
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > SVIX_TOLERANCE_SECONDS) return false;

  // The secret is `whsec_<base64>`; the HMAC key is the decoded base64 portion.
  const secretKey = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(secretKey, 'base64');
  } catch {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const expected = createHmac('sha256', keyBytes).update(signedContent).digest('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');

  // svix-signature: space-separated list of `v1,<base64sig>` entries.
  for (const part of svixSignature.split(' ')) {
    const comma = part.indexOf(',');
    const sig = comma === -1 ? part : part.slice(comma + 1);
    const sigBuf = Buffer.from(sig, 'utf8');
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 60 requests per minute per IP
    const limited = await checkRateLimit(req, { action: 'resend_webhook', max: 60, windowMinutes: 1 });
    if (limited) return limited;

    const body = await req.text();

    // #1430: Resend signs webhooks using Svix (svix-id / svix-timestamp /
    // svix-signature headers, HMAC-SHA256 over `${id}.${timestamp}.${body}`
    // with the base64 secret that follows the `whsec_` prefix). The previous
    // custom `x-webhook-secret` header check would 401 every genuine event
    // (Resend never sends that header), silently killing the integration.
    // Verification is always-on when the secret is set, fail-closed in prod
    // when it is not, and enforces a 5-minute timestamp tolerance.
    const signingSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (!signingSecret) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 403 });
      }
      console.warn('[resend-webhook] RESEND_WEBHOOK_SECRET is not set — skipping verification (dev only)');
    } else {
      const verified = verifySvixSignature(req, body, signingSecret);
      if (!verified) {
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
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

    // Validate event type before processing
    if (!VALID_RESEND_EVENT_TYPES.includes(event.type)) {
      console.log(`[resend-webhook] Ignoring unrecognized event type: ${event.type}`);
      return NextResponse.json({ received: true });
    }
    
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
      case 'email.replied':
        if (email) {
          await handleReply(email);
        }
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
  // DNC flag + enrollment cancellation must be atomic: a contact flagged
  // do-not-contact whose enrollments were left active would keep sending.
  const affectedContacts = await db.transaction(async (tx) => {
    const updatedContacts = await tx
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

    if (updatedContacts.length > 0) {
      const contactIds = updatedContacts.map(c => c.id);
      await tx
        .update(sequenceEnrollments)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(
          inArray(sequenceEnrollments.contactId, contactIds),
          eq(sequenceEnrollments.status, 'active')
        ));
    }

    return updatedContacts;
  });

  if (affectedContacts.length > 0) {
    console.log(`[resend-webhook] ${eventType} (hard): ${affectedContacts.length} contact(s) marked DNC for ${email}`);

    // Activity logging is deliberately AFTER the commit and non-fatal.
    // The activities table requires event_type (NOT NULL); using the wrong
    // column name here used to cause a constraint violation that rolled
    // back the entire transaction, undoing the compliance-critical DNC flag.
    const activityInserts = affectedContacts.map(contact => ({
      tenantId: contact.tenantId,
      contactId: contact.id,
      eventType: 'note',
      description: eventType === 'email.bounced'
        ? `Hard bounce detected - do not contact flag set automatically`
        : `Email complaint received - do not contact flag set automatically`,
      entityType: 'contact',
      entityId: contact.id,
      action: eventType
    }));

    try {
      await db.insert(activities).values(activityInserts);
    } catch (activityErr) {
      await logError({ error: activityErr, context: 'resend-webhook:activity-log' });
    }
  }
}

/**
 * Handle a reply: cancel active sequence enrollments for the replying
 * contact so no further follow-ups are sent to someone who already engaged.
 * Unlike bounces/complaints, a reply must not set doNotContact.
 */
async function handleReply(email: string): Promise<void> {
  const [contact] = await db
    .select({ id: contacts.id, tenantId: contacts.tenantId })
    .from(contacts)
    .where(and(
      eq(contacts.email, email),
      isNull(contacts.deletedAt)
    ))
    .limit(1);

  if (!contact) return;

  const cancelled = await db
    .update(sequenceEnrollments)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(sequenceEnrollments.contactId, contact.id),
      eq(sequenceEnrollments.status, 'active')
    ))
    .returning({ id: sequenceEnrollments.id });

  if (cancelled.length > 0) {
    console.log(`[resend-webhook] email.replied: cancelled ${cancelled.length} active sequence enrollment(s) for ${email}`);
  }

  // Activity logging is deliberately AFTER the update and non-fatal.
  try {
    await db.insert(activities).values({
      tenantId: contact.tenantId,
      contactId: contact.id,
      eventType: 'note',
      description: `Contact replied to an email - active sequence follow-ups stopped`,
      entityType: 'contact',
      entityId: contact.id,
      action: 'email.replied'
    });
  } catch (activityErr) {
    await logError({ error: activityErr, context: 'resend-webhook:activity-log' });
  }
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
    // Atomic read-modify-write: lock the contact row (SELECT ... FOR UPDATE)
    // so two concurrent soft bounces cannot read the same starting metadata
    // and lose an increment. The pruning of stale (>window) bounces and the
    // DNC threshold evaluation both require the post-append array, so we do
    // the whole compute inside the locked transaction rather than in a single
    // SQL statement.
    const escalated = await db.transaction(async (tx): Promise<{ newCount: number; shouldDnc: boolean } | null> => {
      // Re-read metadata under a row lock so the value cannot change until commit.
      const locked = await tx
        .select({ id: contacts.id, metadata: contacts.metadata })
        .from(contacts)
        .where(and(
          eq(contacts.id, contact.id),
          eq(contacts.doNotContact, false),
          isNull(contacts.deletedAt)
        ))
        .for('update');

      // Row may have been escalated/deleted by a concurrent update between the
      // initial select and acquiring the lock — nothing to do.
      const lockedContact = locked[0];
      if (!lockedContact) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = (lockedContact.metadata as any) || {};
      const bounces: string[] = Array.isArray(meta.softBounces) ? meta.softBounces : [];

      // Prune bounces outside the window, then append the current one.
      const recentBounces = bounces.filter(ts => new Date(ts) >= windowStart);
      recentBounces.push(now.toISOString());

      const newCount = recentBounces.length;
      const shouldDnc = newCount >= SOFT_BOUNCE_THRESHOLD;

      if (shouldDnc) {
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
      } else {
        // Just track the soft bounce
        await tx
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
      }

      return { newCount, shouldDnc };
    });

    if (!escalated) continue;

    if (escalated.shouldDnc) {
      console.log(`[resend-webhook] Soft bounce escalated to DNC for contact ${contact.id} (${escalated.newCount} bounces)`);

      // Activity logging is deliberately AFTER the commit and non-fatal.
      try {
        await db.insert(activities).values({
          tenantId: contact.tenantId,
          contactId: contact.id,
          eventType: 'note',
          description: `Soft bounce threshold reached (${escalated.newCount} within ${SOFT_BOUNCE_WINDOW_DAYS} days) - do not contact flag set automatically`,
          entityType: 'contact',
          entityId: contact.id,
          action: 'email.soft_bounce_escalated'
        });
      } catch (activityErr) {
        await logError({ error: activityErr, context: 'resend-webhook:activity-log' });
      }
    } else {
      console.log(`[resend-webhook] Soft bounce tracked for contact ${contact.id} (${escalated.newCount}/${SOFT_BOUNCE_THRESHOLD})`);
    }
  }
}
