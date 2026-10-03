/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { emailOpens, emailClicks } from '@/drizzle/schema/email-tracking';
import { tenants } from '@/drizzle/schema/core';
import { eq } from 'drizzle-orm';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';
import { safeRedirectTarget } from '@/lib/security/redirect-target';
import { logError } from '@/lib/errors-server';

/**
 * Email Open/Click Tracking Endpoints
 *
 * Public endpoints (no auth required) - called from tracking pixel and link redirects.
 * IDs are passed via query parameters.
 *
 * Open-redirect hardening (#2267, same class as #2218): the `?url=` of a click
 * request is the only caller-controlled redirect input this route has, so it is
 * validated through the shared `safeRedirectTarget()` guard (absolute http(s),
 * public host, no credentials, no protocol-relative/relative/smuggled schemes)
 * BEFORE it is persisted to `emailClicks.linkUrl` and again implicitly at
 * redirect time — the `Location` handed to the browser is byte-for-byte the
 * validated string, never the raw parameter. The old hand-rolled host blocklist
 * is gone; it missed whole private ranges, embedded credentials and
 * whitespace-smuggled schemes, and it duplicated logic that now lives in one
 * place (`lib/security/redirect-target.ts` + `lib/security/ssrf`).
 *
 * A failed click-tracking write must never wedge the redirect: the insert runs
 * in its own try/catch, reports through `logError`, and the 302 still happens.
 */

// 1x1 transparent GIF pixel (base64 decoded)
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(req: NextRequest) {
  try {
    // Rate limit public endpoint
    const rateLimited = checkPublicRateLimit(req, { max: 100, windowMs: 60_000, prefix: 'email-track' });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type'); // 'open' or 'click'
    const tenantId = searchParams.get('tid');
    const contactId = searchParams.get('cid');
    const campaignId = searchParams.get('cpid');
    const emailId = searchParams.get('eid');

    if (!tenantId) {
      // Return pixel anyway to avoid broken images
      return new NextResponse(TRACKING_PIXEL, {
        status: 200,
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache' },
      });
    }

    // Validate that the tenant exists before writing tracking records
    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    if (tenantRows.length === 0) {
      // Return pixel anyway to avoid broken images but don't record data
      return new NextResponse(TRACKING_PIXEL, {
        status: 200,
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache' },
      });
    }

    if (type === 'click') {
      const linkUrl = searchParams.get('url');
      if (!linkUrl) {
        return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
      }

      // #2267: validate at WRITE time with the shared guard. Only the validated
      // destination is ever persisted to `emailClicks.linkUrl` or handed to the
      // browser, so a hostile `?url=` can neither become a stored redirect nor
      // a live 302. Unsafe targets get the same plain 4xx this route already
      // used for malformed ones — never a redirect to the attacker's URL.
      const destination = safeRedirectTarget(linkUrl);
      if (destination === null) {
        console.warn('[email-track] click refused unsafe redirect target');
        return NextResponse.json({ error: 'Invalid redirect target' }, { status: 400 });
      }

      // Log click — best effort. A failing write (RLS refusal, DB blip) must
      // not wedge the redirect: catch it, report through the repo logger, and
      // still send the reader to the validated destination below.
      try {
        await db.insert(emailClicks).values({
          tenantId,
          contactId: contactId || null,
          campaignId: campaignId || null,
          emailId: emailId || null,
          linkUrl: destination,
          ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        });
      } catch (err) {
        void logError({ error: err, context: 'tenant/email/track click-log', level: 'warning' });
      }

      // 302 redirect to destination — `destination` is the exact string
      // `safeRedirectTarget()` approved (absolute http(s), public host).
      return NextResponse.redirect(destination, 302);
    }

    // Default: tracking pixel (open tracking)
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null;
    const userAgent = req.headers.get('user-agent') || null;

    await db.insert(emailOpens).values({
      tenantId,
      contactId: contactId || null,
      campaignId: campaignId || null,
      emailId: emailId || null,
      ipAddress,
      userAgent,
    });

    return new NextResponse(TRACKING_PIXEL, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (err) {
    // Even on error, return the pixel to avoid broken images
    void logError({ error: err, context: 'tenant/email/track', level: 'warning' });
    return new NextResponse(TRACKING_PIXEL, {
      status: 200,
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
    });
  }
}
