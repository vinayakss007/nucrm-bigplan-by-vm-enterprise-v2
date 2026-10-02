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
