/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Email Click Tracking Proxy
 * GET /api/track/click?t=TRACKING_ID&l=LINK_ID
 *
 * Records the click and redirects to the destination that was REGISTERED ON THE
 * TRACKING ROW when the mail was written (see `readClickLinkDestination` in
 * `lib/email/tracking.ts`).
 *
 * Anti-open-redirect (#1981, closed properly in #2218): the `Location` of this
 * 302 comes from the server-side tracked-link row and nowhere else. #1981 only
 * required that *some* row existed for `t` and then redirected to whatever the
 * caller passed in `?url=` — so any recipient of one tracked mail (every
 * tracking id is a real uuid they already hold) could append
 * `&url=https://phish.example` and get a 302 off the CRM domain. That is a
 * textbook phishing cover, and it also let anyone stamp clicks onto another
 * tenant's analytics. `?url=` is therefore not read at all any more: the only
 * caller-controlled input that influences the destination is `l`, an opaque key
 * that selects among the URLs the SENDER stored on that row.
 *
 * Statuses: unknown / malformed / absent token → 404, token whose row was
 * soft-deleted → 410, a row whose registered destination is missing or fails
 * validation → 302 to the app root (a real recipient must never be stranded on
 * an error page), otherwise 302 to the registered destination.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { emailTracking, activities } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { safeRedirectTarget } from '@/lib/security/redirect-target';
import { readClickLinkDestination } from '@/lib/email/tracking';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';
import { withTenantContext, withTrackingLookupContext, NO_USER_SENTINEL } from '@/lib/db/rls';

/**
 * Tracking ids are server-minted uuids. Anything that is not uuid-shaped is
 * refused before a query runs, so guessing/probing costs the caller nothing and
 * the database nothing either.
 */
const TRACK_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trackId = searchParams.get('t');
  const linkId = searchParams.get('l');

  // #2218: a request without a well-formed token is not a click on a tracked
  // mail at all, so it gets 404 — not a redirect. Responding 302 to '/' here
  // would make this endpoint a live redirect oracle for anyone probing ids.
  if (!trackId || !TRACK_ID_RE.test(trackId)) {
    return NextResponse.json({ error: 'tracking id not found' }, { status: 404 });
  }

  // #1143: public, unauthenticated endpoint. Rate-limit the click-count write
  // per IP to stop analytics inflation, but ALWAYS perform the redirect below so
  // a real recipient's link never breaks — a suppressed write just avoids
  // over-counting one click.
  const rateLimited = checkPublicRateLimit(req, { max: 60, windowMs: 60_000, prefix: 'track-click' });

  // Explicit row type: `as typeof row` used to be used here, but inside this
  // scope `row` is control-flow-narrowed to `null`, so that cast made the row
  // `null` (and every later `tracked.*` access `never`) — 6 type errors.
  type TrackingRow = {
    id: string;
    contactId: string | null;
    tenantId: string;
    clickCount: number | null;
    deletedAt: Date | null;
    metadata: unknown;
  };
  let row: TrackingRow | null = null;
  let lookupFailed = false;
  try {
    // This read decides where the browser is sent, so it has to work from a
    // connection with no tenant GUC at all. Without the lookup context the
    // query returned nothing even for a genuine row, which made the #1981 gate
    // fail closed every real link — recipients of a wrapped URL landed on '/'
    // instead of the destination. The context is transaction-local and admits
    // SELECT on this one table only (migration 0105).
    //
    // `deletedAt` is selected rather than filtered so a soft-deleted link can
    // answer 410 (gone) instead of 404 (never existed).
    const found = await withTrackingLookupContext((tx) =>
      tx.query.emailTracking.findFirst({
        where: eq(emailTracking.id, trackId),
        columns: {
          id: true,
          contactId: true,
          tenantId: true,
          clickCount: true,
          deletedAt: true,
          metadata: true
        }
      })
    );
    row = found ?? null;
  } catch (err) {
    lookupFailed = true;
    void logError({ error: err, context: 'track/click lookup', level: 'warning' });
  }

  if (!row) {
    // No row for a uuid-shaped token means the link was never mailed: 404, and
    // nothing is written. A lookup that threw is a different story — the link
    // may well be genuine, so land the reader on the app root rather than
    // stranding them on an error page because our database had a bad second.
    if (lookupFailed) {
      return NextResponse.redirect(new URL('/', req.url), { status: 302 });
    }
    return NextResponse.json({ error: 'tracking id not found' }, { status: 404 });
  }

  if (row.deletedAt) {
    return NextResponse.json({ error: 'tracking link no longer available' }, { status: 410 });
  }

  const tracked = row;

  // The destination is READ FROM THE ROW. `l` can only pick between destinations
  // the sender registered there; it can never introduce one.
  const storedUrl = readClickLinkDestination(tracked.metadata, linkId);
  const destination = storedUrl === null ? null : safeRedirectTarget(storedUrl);
  if (storedUrl !== null && destination === null) {
    // A registered destination that is not a safe absolute http(s) target —
    // e.g. a `javascript:` value written before this validation existed.
    console.warn('[track] click refused unsafe registered destination for tracking id', tracked.id);
  }

  if (!rateLimited) {
    // Record click — fire and forget. Both halves run in one tenant-scoped
    // transaction, and the outer `.catch` is not decoration: an unhandled
    // rejection from a detached promise can raise `unhandledRejection` in the
    // Node process and take the redirect (or the worker) down with it.
    Promise.resolve()
      .then(async () => {
        // The counter update and the activity row are both checked against
        // app.current_tenant, so they need the tenant the tracking row named.
        await withTenantContext(tracked.tenantId, NO_USER_SENTINEL, async (tx) => {
          await tx.update(emailTracking)
            .set({
              clickedAt: sql`COALESCE(${emailTracking.clickedAt}, now())`,
              clickCount: sql`${emailTracking.clickCount} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(emailTracking.id, tracked.id));

          // Log activity — only the validated, server-side destination is
          // recorded, so nothing an attacker typed lands in a tenant's feed.
          if (tracked.contactId) {
            await tx.insert(activities).values({
              tenantId: tracked.tenantId,
              contactId: tracked.contactId,
              eventType: 'email',
              description: 'Email link clicked',
              metadata: { tracking_id: tracked.id, url: destination, event: 'click' },
              entityType: 'contact',
              entityId: tracked.contactId,
              action: 'email_click'
            });
          }
        });
      })
      .catch((err) => {
        void logError({ error: err, context: 'track/click open-tracking', level: 'warning' });
        /* never fail on tracking */
      });
  }

  // NextResponse.redirect requires an absolute URL — '/' alone throws
  // ERR_INVALID_URL (previously a latent 500 on every fallback). `destination`
  // is absolute http(s) whenever it exists, so the base is only used for the
  // "no registered destination" fallback.
  return NextResponse.redirect(new URL(destination ?? '/', req.url), { status: 302 });
}
