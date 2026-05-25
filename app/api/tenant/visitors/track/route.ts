import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { visitors, pageViews } from '@/drizzle/schema/visitors';
import { eq, and } from 'drizzle-orm';
import { scorePageUrl } from '@/lib/visitor-tracking';

/**
 * Public endpoint for visitor tracking.
 * No auth required - uses x-api-key header to resolve tenant.
 * Lightweight and fast for use by frontend tracking scripts.
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json({ error: 'x-api-key header required' }, { status: 401 });
    }

    // Resolve tenant from API key
    // In production, look up the tenant via API key table
    // For now, use the key directly as tenantId (simplified)
    const tenantId = apiKey;

    const body = await req.json();
    const { visitorId, fingerprintId, url, title, referrer, duration } = body;

    if (!visitorId || !url) {
      return NextResponse.json({ error: 'visitorId and url are required' }, { status: 400 });
    }

    // Insert page view
    await db.insert(pageViews).values({
      tenantId,
      visitorId,
      url,
      title: title || '',
      referrer: referrer || '',
      durationSeconds: duration || 0,
    });

    // Upsert visitor
    const existing = await db
      .select()
      .from(visitors)
      .where(and(eq(visitors.id, visitorId), eq(visitors.tenantId, tenantId)));

    if (existing.length === 0) {
      // Create new visitor
      await db.insert(visitors).values({
        id: visitorId,
        tenantId,
        fingerprintId: fingerprintId || visitorId,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        totalPageViews: 1,
        score: scorePageUrl(url),
      });
    } else {
      // Update existing visitor
      const points = scorePageUrl(url);
      await db
        .update(visitors)
        .set({
          lastSeenAt: new Date(),
          totalPageViews: (existing[0]!.totalPageViews ?? 0) + 1,
          score: (existing[0]!.score ?? 0) + points,
        })
        .where(eq(visitors.id, visitorId));
    }

    // Return immediately for speed
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    // Still return 200 to not block client-side tracking
    console.error('[visitor-track] Error:', err);
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
