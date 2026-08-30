/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { visitors, pageViews } from '@/drizzle/schema/visitors';
import { apiKeys } from '@/drizzle/schema/core';
import { eq, and } from 'drizzle-orm';
import { scorePageUrl } from '@/lib/visitor-tracking';
import { createHash } from 'crypto';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';
import { readJsonBody } from '@/lib/api/validate';

/**
 * #1074 (defense-in-depth): visitor-supplied url/title/referrer are stored raw
 * and later rendered in dashboards/activity feeds. Strip tag characters and cap
 * length before persisting so a page view cannot carry a stored-XSS payload.
 * Mirrors sanitizeTrackingField() in lib/visitor-tracking.ts.
 */
function sanitizeTrackingField(value: unknown, maxLen = 2048): string {
  if (!value) return '';
  return String(value).replace(/[<>]/g, '').slice(0, maxLen);
}

/**
 * Public endpoint for visitor tracking.
 * No auth required - uses x-api-key header to resolve tenant.
 * The API key is looked up in the api_keys table to determine the tenant.
 * Lightweight and fast for use by frontend tracking scripts.
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit public endpoint
    const rateLimited = checkPublicRateLimit(req, { max: 100, windowMs: 60_000, prefix: 'visitor-track' });
    if (rateLimited) return rateLimited;

    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json({ error: 'x-api-key header required' }, { status: 401 });
    }

    // Resolve tenant from API key by hashing and looking up in the api_keys table
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const keyRows = await db
      .select({ tenantId: apiKeys.tenantId })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)));

    const keyRow = keyRows[0];
    if (!keyRow) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const tenantId = keyRow.tenantId;

    const body = await readJsonBody(req);
    const { visitorId, fingerprintId, url, title, referrer, duration } = body;

    if (!visitorId || !url) {
      return NextResponse.json({ error: 'visitorId and url are required' }, { status: 400 });
    }

    // Sanitize visitor-supplied fields before persisting (see note above).
    const safeUrl = sanitizeTrackingField(url);
    const safeTitle = sanitizeTrackingField(title, 512);
    const safeReferrer = sanitizeTrackingField(referrer);
    const safeDuration = Number.isFinite(Number(duration)) ? Math.max(0, Math.trunc(Number(duration))) : 0;

    await db.transaction(async (tx) => {
      await tx.insert(pageViews).values({
        tenantId,
        visitorId,
        url: safeUrl,
        title: safeTitle,
        referrer: safeReferrer,
        durationSeconds: safeDuration,
      });

      const existing = await tx
        .select()
        .from(visitors)
        .where(and(eq(visitors.id, visitorId), eq(visitors.tenantId, tenantId)));

      if (existing.length === 0) {
        await tx.insert(visitors).values({
          id: visitorId,
          tenantId,
          fingerprintId: fingerprintId || visitorId,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          totalPageViews: 1,
          score: scorePageUrl(safeUrl),
        });
      } else {
        const points = scorePageUrl(safeUrl);
        await tx
          .update(visitors)
          .set({
            lastSeenAt: new Date(),
            totalPageViews: (existing[0]!.totalPageViews ?? 0) + 1,
            score: (existing[0]!.score ?? 0) + points,
          })
          .where(eq(visitors.id, visitorId));
      }
    });

    // Return immediately for speed
    return NextResponse.json({ ok: true }, { status: 200 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // Still return 200 to not block client-side tracking
    void logError({ error: err, context: 'tenant/visitors/track', level: 'warning' });
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
