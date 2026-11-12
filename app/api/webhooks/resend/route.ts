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
import { logError } from '@/lib/errors-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { attributeResendEvent, type AttributedScope } from '@/lib/email/webhook-scope';
import { handleHardBounce, handleReply, handleSoftBounce } from '@/lib/email/resend-event-handlers';
import { withTenantScope } from '@/lib/api/with-api-route';

const VALID_RESEND_EVENT_TYPES = [
  'email.bounced',
  'email.complained',
  'email.delivered',
  'email.sent',
  'email.opened',
  'email.clicked',
  'email.replied',
];

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
  // #3246: the tenant adopted below lives on the connection that set it and the
  // pool clears it on release, and nothing wraps this anonymous path — pin one
  // client or every statement after the attribution still reads an empty tenant.
  return withTenantScope(() => handleResend(req));
}

async function handleResend(req: NextRequest) {
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

    // #2406: the event identifies a recipient, not a workspace, and one
    // workspace's bounce must not suppress another customer's contact. Resolve
    // the tenant BEFORE anything is written; an event that cannot be
    // attributed is counted and dropped rather than applied everywhere.
    const WRITING_EVENT_TYPES = new Set(['email.bounced', 'email.complained', 'email.replied']);
    let attributed: AttributedScope | null = null;
    if (email && WRITING_EVENT_TYPES.has(event.type)) {
      const scope = await attributeResendEvent({
        emailId: event.data?.email_id ?? null,
        recipient: email,
      });
      if (scope.kind === 'unattributed') {
        // Recipient local part is deliberately absent: this row outlives the
        // event and a support table is not where a customer's contact list
        // belongs. The domain plus the provider message id is enough to triage.
        await logError({
          error: new Error(`Unattributed Resend ${event.type} (${scope.reason}) — no tenant write applied`),
          context: 'resend-webhook:unattributed',
          level: 'warning',
          metadata: {
            eventType: event.type,
            emailId: event.data?.email_id ?? null,
            recipientDomain: email.split('@')[1] ?? null,
            candidates: scope.candidates,
            bounceType: event.data?.bounce_type ?? null,
          },
          captureToSentry: false,
        });
        console.warn(`[resend-webhook] DROPPED ${event.type} (${scope.reason}) — ${email.split('@')[1] ?? 'no-domain'}`);
        return NextResponse.json({ received: true, attributed: false });
      }
      attributed = scope;
    }

    switch (event.type) {
      case 'email.bounced': {
        if (!email || !attributed) break;
        
        // Determine if this is a hard or soft bounce
        // Resend may provide bounce_type in data; default to hard for safety
        const bounceType = event.data.bounce_type === 'soft' ? 'soft' : 'hard';

        if (bounceType === 'hard') {
          // Hard bounce: immediately set doNotContact
          await handleHardBounce(attributed, email, event.type);
        } else {
          // Soft bounce: track and escalate after threshold
          await handleSoftBounce(attributed, email);
        }
        break;
      }
      case 'email.complained': {
        if (email && attributed) {
          // Complaints always immediately DNC
          await handleHardBounce(attributed, email, event.type);
        }
        break;
      }
      case 'email.delivered':
        // Optional: track delivery in email_log if needed
        break;
      case 'email.replied':
        if (email && attributed) {
          await handleReply(attributed, email);
        }
        break;
      default:
        console.log(`[resend-webhook] Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
 
 
  } catch (err) {
    await logError({ error: err, context: 'resend-webhook' });
    return apiError(err);
  }
}
