import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { emailOpens, emailClicks } from '@/drizzle/schema/email-tracking';

/**
 * Email Open/Click Tracking Endpoints
 *
 * Public endpoints (no auth required) - called from tracking pixel and link redirects.
 * IDs are passed via query parameters.
 */

// 1x1 transparent GIF pixel (base64 decoded)
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(req: NextRequest) {
  try {
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

    if (type === 'click') {
      const linkUrl = searchParams.get('url');
      if (!linkUrl) {
        return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
      }

      // Log click
      await db.insert(emailClicks).values({
        tenantId,
        contactId: contactId || null,
        campaignId: campaignId || null,
        emailId: emailId || null,
        linkUrl,
        ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
      });

      // 302 redirect to destination
      return NextResponse.redirect(linkUrl, 302);
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
    return new NextResponse(TRACKING_PIXEL, {
      status: 200,
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
    });
  }
}
