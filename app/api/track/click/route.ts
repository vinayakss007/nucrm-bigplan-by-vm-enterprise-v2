/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Email Click Tracking Proxy
 * GET /api/track/click?t=TRACKING_ID&url=ENCODED_URL
 *
 * Records click and redirects to the actual URL.
 * Wrap links in emails: <a href="APP_URL/api/track/click?t=TRACKING_ID&url=ENCODED_URL">
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { emailTracking, activities } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { isPrivateIpv4, isPrivateIpv6, isBlockedHostname } from '@/lib/security/ssrf';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trackId  = searchParams.get('t');
  const rawUrl   = searchParams.get('url');

  // Validate destination URL
  let destination = '/';
  if (rawUrl) {
    try {
      const decoded = decodeURIComponent(rawUrl);
      if (/^https?:\/\//i.test(decoded)) {
        const dest = new URL(decoded);
        const host = dest.hostname;
        if (isBlockedHostname(host) || isPrivateIpv4(host) || isPrivateIpv6(host)) {
          console.warn('[track] click blocked SSRF attempt to', host);
        } else {
          destination = decoded;
        }
      }
  } catch (err) {
    console.error('[track] click error', err);
  }
  }

  // #1143: public, unauthenticated endpoint. Rate-limit the click-count write
  // per IP to stop analytics inflation, but ALWAYS perform the redirect below so
  // a real recipient's link never breaks — a suppressed write just avoids
  // over-counting one click.
  const rateLimited = checkPublicRateLimit(req, { max: 60, windowMs: 60_000, prefix: 'track-click' });

  if (trackId && !rateLimited) {
    // Record click — fire and forget
    Promise.resolve().then(async () => {
      try {
        const row = await db.query.emailTracking.findFirst({
          where: and(eq(emailTracking.id, trackId), isNull(emailTracking.deletedAt)),
          columns: {
            id: true,
            contactId: true,
            tenantId: true,
            clickCount: true
          }
        });
        if (!row) return;

        await db.transaction(async (tx) => {
          await tx.update(emailTracking)
            .set({
              clickedAt: sql`COALESCE(${emailTracking.clickedAt}, now())`,
              clickCount: sql`${emailTracking.clickCount} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(emailTracking.id, trackId));

          // Log activity
          if (row.contactId) {
            await tx.insert(activities).values({
              tenantId: row.tenantId,
              contactId: row.contactId,
              eventType: 'email',
              description: 'Email link clicked',
              metadata: { tracking_id: trackId, url: destination, event: 'click' },
              entityType: 'contact',
              entityId: row.contactId,
              action: 'email_click'
            });
          }
        });
      } catch (err) { 
        console.error('[TrackClick] Error:', err);
        /* never fail on tracking */ 
      }
    });
  }

  return NextResponse.redirect(destination, { status: 302 });
}
