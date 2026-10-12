/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';

/**
 * RETIRED — `GET /api/tenant/email/track` (#2526).
 *
 * This was the original open/click ingestion endpoint: it took `tid`, `cid`,
 * `cpid`, `eid` and (for a click) the redirect target `url` straight from the
 * query string and wrote `email_opens` / `email_clicks` from them. Nothing
 * about those values was ever proven — not that the caller belonged to `tid`,
 * not that `cid`/`cpid`/`eid` existed, not that the caller was anyone at all.
 * The successor pair does the same job with a credential instead of a claim:
 * `/api/track/open?t=` and `/api/track/click?t=&l=` resolve one
 * `email_tracking` row from the unguessable id the sending side minted for
 * that recipient (`lib/email/tracking.ts:86`, `:106`), take the tenant from
 * that row rather than from the query string, and reads the click destination
 * out of the registered link (`app/api/track/click/route.ts:125-126`) instead
 * of accepting one.
 *
 * Three measurements are why this file is a tombstone and not a hardening:
 *
 * 1. **No caller can reach it as intended.** `/api/tenant/email/track` has
 *    never appeared in `proxy.ts`'s public lists — `git log -S"email/track"
 *    -- proxy.ts` returns no commit — so the mail client that renders a
 *    tracking pixel is answered `401 {"error":"Authentication required"}` at
 *    the edge (`proxy.ts:498`) and the handler never runs. Pinned by
 *    `tests/unit/proxy.test.ts` (#2526), next to the equivalent
 *    `/api/tenant/visitors/track` pin from #2415.
 * 2. **Nothing builds these URLs.** The only two `db.insert(emailOpens)` /
 *    `db.insert(emailClicks)` statements in the tree were in this file, and no
 *    generator, template, doc, Postman step or script anywhere produced a
 *    `/api/tenant/email/track?…` link. Retiring it therefore removes a write
 *    surface, not a feature.
 * 3. **Even when reached, it recorded nothing.** The handler never called
 *    `requireAuth` or `withApiRoute`, so it ran on the bare pool with no
 *    `app.current_tenant`. Measured on a table built from the verbatim
 *    `tenant_isolation` expression read out of `pg_policy.polqual` for the live
 *    `email_opens`: with no GUC the insert is refused — `42501 new row violates
 *    row-level security policy` — and a caller who did get here was handed a
 *    GIF and a 302 out of a write that had already failed. Give the same table
 *    a real tenant context and the shape #2526 describes appears: the policy
 *    checks `tenant_id` and nothing else, so a row landed carrying **another
 *    tenant's `contact_id`** (foreign-key valid, tenant-blind) plus a
 *    `campaign_id` and `email_id` that exist nowhere —
 *    `drizzle/schema/email-tracking.ts:16-17` declares those two with no
 *    reference at all.
 *
 * So the endpoint could not be used by its intended caller, was not used by
 * any caller in the tree, and did not record anything for the callers who did
 * reach it. That is a surface to delete, not a bug to fix.
 *
 * 410 (Gone) rather than deleting the file: it answers a stale link with a
 * terminal status instead of Next's 404 page, and it points a caller at the
 * endpoint that does record the event. **No response here ever carries a
 * `Location`** — a retired redirector must not become a live one, and the
 * `?url=` a caller supplies is never echoed back. The write path is gone, so
 * `?type=click&url=javascript:…` and a plain `https://example.com/deal/1` get
 * the same 410 as the pixel, with no database call in front of it — both
 * measured in `tests/unit/email-track-retirement-2526.test.ts`.
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      error: 'This email-tracking endpoint was retired (#2526).',
      use: {
        open: '/api/track/open?t=<per-message tracking id>',
        click: '/api/track/click?t=<per-message tracking id>&l=<registered link id>',
      },
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
    },
  );
}
