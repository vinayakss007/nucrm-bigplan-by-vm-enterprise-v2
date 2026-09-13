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
 *
 * Anti-open-redirect (#1981): the destination is honored ONLY when `t`
 * identifies a real email_tracking row. Tracking ids are unguessable uuids
 * minted server-side, so an attacker cannot craft a working redirect link;
 * anything else falls back to '/'. (No first-party code mints these links
 * yet, so there are no legacy unsigned links to keep working.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { emailTracking, activities } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { isPrivateIpv4, isPrivateIpv6, isBlockedHostname } from '@/lib/security/ssrf';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trackId  = searchParams.get('t');
  const rawUrl   = searchParams.get('url');

  // Validate destination URL shape (SSRF + scheme). Whether it is HONORED
  // is decided below: only a request carrying a real tracking id redirects
  // externally (#1981), otherwise this endpoint would be an open redirector
  // turning our domain into phishing cover. Anything else falls back to '/'.
  const trackIdIsPlausible = !!trackId && /^[0-9a-fA-F-]{8,64}$/.test(trackId);
  let candidate = '/';
  if (rawUrl) {
    try {
      const decoded = decodeURIComponent(rawUrl);
      if (/^https?:\/\//i.test(decoded)) {
        const dest = new URL(decoded);
        const host = dest.hostname;
        if (isBlockedHostname(host) || isPrivateIpv4(host) || isPrivateIpv6(host)) {
          console.warn('[track] click blocked SSRF attempt to', host);
        } else {
          candidate = decoded;
        }
      }
  } catch (err) {
    void logError({ error: err, context: 'track/click', level: 'warning' });
  }
  }

  // #1143: public, unauthenticated endpoint. Rate-limit the click-count write
  // per IP to stop analytics inflation, but ALWAYS perform the redirect below so
  // a real recipient's link never breaks — a suppressed write just avoids
  // over-counting one click.
  const rateLimited = checkPublicRateLimit(req, { max: 60, windowMs: 60_000, prefix: 'track-click' });

  // Gate the redirect on a REAL tracking row (#1981). The id is an
  // unguessable server-minted uuid, so only genuine email links redirect
  // externally; forged/unknown ids fall back to '/'.
  let destination = '/';
  let row: { id: string; contactId: string | null; tenantId: string } | null = null;
  if (trackId && trackIdIsPlausible) {
    try {
      row = (await db.query.emailTracking.findFirst({
        where: and(eq(emailTracking.id, trackId), isNull(emailTracking.deletedAt)),
        columns: {
          id: true,
          contactId: true,
          tenantId: true,
          clickCount: true
        }
      })) as typeof row;
    } catch (err) {
      void logError({ error: err, context: 'track/click lookup', level: 'warning' });
    }
  }
  if (row) destination = candidate;

  if (row && !rateLimited) {
    const tracked = row;
    // Record click — fire and forget
    Promise.resolve().then(async () => {
      try {
        await db.transaction(async (tx) => {
          await tx.update(emailTracking)
            .set({
              clickedAt: sql`COALESCE(${emailTracking.clickedAt}, now())`,
              clickCount: sql`${emailTracking.clickCount} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(emailTracking.id, trackId));

          // Log activity
          if (tracked.contactId) {
            await tx.insert(activities).values({
              tenantId: tracked.tenantId,
              contactId: tracked.contactId,
              eventType: 'email',
              description: 'Email link clicked',
              metadata: { tracking_id: trackId, url: destination, event: 'click' },
              entityType: 'contact',
              entityId: tracked.contactId,
              action: 'email_click'
            });
          }
        });
      } catch (err) { 
        void logError({ error: err, context: 'track/click open-tracking', level: 'warning' });
        /* never fail on tracking */ 
      }
    });
  }

  // NextResponse.redirect requires an absolute URL — '/' alone throws
  // ERR_INVALID_URL (previously a latent 500 on every fallback).
  return NextResponse.redirect(new URL(destination, req.url), { status: 302 });
}
