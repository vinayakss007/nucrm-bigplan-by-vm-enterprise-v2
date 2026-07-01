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
import { eq, sql } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trackId  = searchParams.get('t');
  const rawUrl   = searchParams.get('url');

  // Validate destination URL
  let destination = '/';
  if (rawUrl) {
    try {
      const decoded = decodeURIComponent(rawUrl);
      // Only allow http/https URLs — prevent open redirect to javascript:
      if (/^https?:\/\//i.test(decoded)) destination = decoded;
  } catch (err) {
    console.error('[track] click error', err);
  }
  }

  if (trackId) {
    // Record click — fire and forget
    Promise.resolve().then(async () => {
      try {
        const row = await db.query.emailTracking.findFirst({
          where: eq(emailTracking.id, trackId),
          columns: {
            id: true,
            contactId: true,
            tenantId: true,
            clickCount: true
          }
        });
        if (!row) return;

        await db.update(emailTracking)
          .set({
            clickedAt: sql`COALESCE(${emailTracking.clickedAt}, now())`,
            clickCount: sql`${emailTracking.clickCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(emailTracking.id, trackId));

        // Log activity
        if (row.contactId) {
          await db.insert(activities).values({
            tenantId: row.tenantId,
            contactId: row.contactId,
            eventType: 'email',
            description: 'Email link clicked',
            metadata: { tracking_id: trackId, url: destination, event: 'click' },
            entityType: 'contact',
            entityId: row.contactId,
            action: 'email_click'
          }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
        }
      } catch (err) { 
        console.error('[TrackClick] Error:', err);
        /* never fail on tracking */ 
      }
    });
  }

  return NextResponse.redirect(destination, { status: 302 });
}
