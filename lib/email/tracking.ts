/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from 'crypto';
import { logger } from '@/lib/logger';

/**
 * Register one outgoing message for open tracking and return the id that the
 * tracking pixel is rendered with. Returns null instead of throwing: a message
 * that cannot be tracked is still a message that should be sent.
 */
export async function createEmailTracking(data: {
  tenantId: string;
  contactId: string;
  recipient: string;
  subject: string;
  sequenceEnrollmentId?: string;
  bodyText?: string;
}): Promise<string | null> {
  try {
    const { db } = await import('@/drizzle/db');
    const { emailTracking } = await import('@/drizzle/schema');
    const trackingId = crypto.randomUUID();

    await db.insert(emailTracking).values({
      id: trackingId,
      tenantId: data.tenantId,
      contactId: data.contactId,
      recipient: data.recipient,
      subject: data.subject,
      sequenceEnrollmentId: data.sequenceEnrollmentId || null,
    });

    // Analyze sentiment from email subject/body and update contact's deals
    const textToAnalyze = data.bodyText ? `${data.subject}\n\n${data.bodyText}` : data.subject;
    if (textToAnalyze.trim()) {
      const { analyzeSentimentForContact } = await import('@/lib/ai/sentiment');
      analyzeSentimentForContact(data.contactId, data.tenantId, textToAnalyze.slice(0, 2000)).catch((err: unknown) => {
        logger.error('[email] Sentiment analysis failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }

    return trackingId;
  } catch (err) {
    logger.error('[email] Failed to create tracking', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Add the open-tracking pixel to HTML.
 *
 * The path and query name are load-bearing: `/api/track/open` is the public
 * unauthenticated endpoint and it reads the id from `?t=`. The former
 * `/api/track/open?t=` matched no route and fell through the auth
 * middleware with a 401, so the image never loaded and no open was ever
 * recorded for a sequence email.
 */
export function addTracking(html: string, trackingId: string, appUrl: string): string {
  const trackingPixel = `<img src="${appUrl}/api/track/open?t=${trackingId}" width="1" height="1" style="display:none" />`;
  return html.replace('</body>', `${trackingPixel}</body>`);
}

/**
 * ── Click destinations (#2218) ─────────────────────────────────────────────
 *
 * `/api/track/click?t=…&l=…` may ONLY redirect to a URL that the sending side
 * stored on the tracking row. The token selects the row, `l` selects one of the
 * destinations recorded on that row — the browser's `Location` is never taken
 * from the query string. That is the whole defence: an attacker who owns a
 * genuine tracking id (every recipient of a tracked mail does) still cannot make
 * our domain 302 to a host that was not registered when the mail was written.
 *
 * Registration contract, owned by this module so the writer and the reader
 * cannot drift (same reasoning as `lib/email/unsubscribe-token.ts`):
 *
 *   email_tracking.metadata = { clickLinks: { "<linkId>": "https://…" } }
 *
 * e.g. a sender that rewrites `<a href="https://acme.io/offer">` into
 * `${APP_URL}/api/track/click?t=${trackingId}&l=offer` stores
 * `{ clickLinks: { offer: 'https://acme.io/offer' } }` on the same row.
 * Link ids are opaque keys (`[A-Za-z0-9_-]{1,64}`), never array positions, so
 * editing one link cannot silently re-point every other link in the mail.
 */
export const CLICK_LINKS_METADATA_KEY = 'clickLinks';

/** A link id is a key into the row's own metadata — keep it boring and short. */
const CLICK_LINK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Read the destination registered on a tracking row for one link.
 *
 * `linkId` (the `?l=` of the click request) may only *choose among* destinations
 * the server stored; when it is absent and exactly one destination is
 * registered, that single link is the unambiguous answer. Everything else —
 * no metadata, a malformed shape, an unknown link id, several links with no `l`
 * — returns null and the caller must NOT redirect off-box.
 */
export function readClickLinkDestination(metadata: unknown, linkId: string | null): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  const rawLinks = (metadata as Record<string, unknown>)[CLICK_LINKS_METADATA_KEY];
  if (!rawLinks || typeof rawLinks !== 'object' || Array.isArray(rawLinks)) return null;

  const links = rawLinks as Record<string, unknown>;

  if (linkId !== null) {
    if (!CLICK_LINK_ID_RE.test(linkId)) return null;
    const stored = Object.prototype.hasOwnProperty.call(links, linkId) ? links[linkId] : undefined;
    return typeof stored === 'string' ? stored : null;
  }

  const keys = Object.keys(links);
  if (keys.length !== 1) return null;
  const stored = links[keys[0]!];
  return typeof stored === 'string' ? stored : null;
}
