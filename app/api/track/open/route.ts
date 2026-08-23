/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Email Open Tracking Pixel
 * GET /api/track/open?t=TRACKING_ID
 *
 * Returns a 1x1 transparent GIF and records the open event.
 * Embed in emails: <img src="https://yourapp.com/api/track/open?t=TRACKING_ID" width="1" height="1" />
 *
 * To generate tracking ID when sending email:
 *   const trackId = await createEmailTracking(tenantId, contactId, recipient, subject);
 *   Include in HTML: `<img src="${APP_URL}/api/track/open?t=${trackId}" ... />`
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { emailTracking, activities } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(req: NextRequest) {
  const trackId = new URL(req.url).searchParams.get('t');

  if (trackId) {
    // Record open — fire and forget, never block
    Promise.resolve().then(async () => {
      try {
        const row = await db.query.emailTracking.findFirst({
          where: and(eq(emailTracking.id, trackId), isNull(emailTracking.deletedAt)),
          columns: {
            id: true,
            contactId: true,
            tenantId: true,
            openCount: true
          }
        });
        if (!row) return;

        await db.transaction(async (tx) => {
          await tx.update(emailTracking)
            .set({
              openedAt: sql`COALESCE(${emailTracking.openedAt}, now())`,
              openCount: sql`${emailTracking.openCount} + 1`
            })
            .where(eq(emailTracking.id, trackId));

          // Log activity on first open only
          if (row.openCount === 0 && row.contactId) {
            await tx.insert(activities).values({
              tenantId: row.tenantId,
              contactId: row.contactId,
              eventType: 'email',
              description: 'Email opened',
              metadata: { tracking_id: trackId, event: 'open' },
              entityType: 'contact',
              entityId: row.contactId,
              action: 'email_open'
            });
          }
        });
      } catch (err) { 
        console.error('[TrackOpen] Error:', err);
        /* never fail on tracking */ 
      }
    }).catch((err) => { console.error('[TrackOpen] Unhandled:', err); });
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type':  'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma':        'no-cache',
    },
  });
}
