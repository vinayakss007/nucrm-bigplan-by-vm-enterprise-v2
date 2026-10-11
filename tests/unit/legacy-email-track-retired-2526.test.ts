/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2526 — `/api/tenant/email/track` is retired, and the token-keyed pair stays
 * the only anonymous email-event ingestion in this app.
 *
 * The issue's premise was that this route was an unauthenticated sink taking
 * `tid`/`cid`/`cpid`/`eid` straight off the query string. Half of that is true
 * and the half that is not is what the route was for: the handler's own docblock
 * said "Public endpoints (no auth required)" and `app/api/tenant/email/analytics`
 * repeated it, but `proxy.ts` never listed the path, so an email client fetching
 * the pixel got a 401 from the edge and never reached the handler — and the two
 * inserts could not have landed anyway, because the route used the bare `db`
 * pool and `0031_rls_remaining_tables.sql` gives `email_opens`/`email_clicks` a
 * `WITH CHECK (tenant_id::text = current_setting('app.current_tenant'))` that no
 * caller can satisfy without a tenant context. Dead as an ingestion endpoint,
 * and still a live 302 off the app's own domain to any *public* URL an
 * authenticated caller (or an `ak_` API key) chose — the phishing-cover shape
 * #1981/#2218 closed on `/api/track/click` and left here.
 *
 * These tests pin the deletion, the sibling it must not be confused with, and
 * the properties that make the two successors safe: a server-minted uuid is the
 * only credential, no caller-supplied ids, and the tenant the write runs under
 * comes from the row the token resolved.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/**
 * Reproduce `proxy.ts`'s own `isPublic()` matching rules (exact, or as a path
 * segment prefix) against the two arrays it declares, so this screen fails when
 * the config changes rather than when a comment does.
 */
const proxySource = src('proxy.ts');

function arrayLiterals(name: string): string[] {
  const start = proxySource.indexOf(`const ${name} = [`);
  if (start === -1) throw new Error(`proxy.ts no longer declares ${name} as an array literal`);
  const body = proxySource.slice(start, proxySource.indexOf('];', start));
  const spread = [...body.matchAll(/\.\.\.([A-Z_]+)/g)].flatMap((m) => arrayLiterals(m[1]));
  const quoted = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  return [...spread, ...quoted.filter((s) => s.length > 0)];
}

const publicPaths = arrayLiterals('PUBLIC_PATHS');
const publicPrefixes = arrayLiterals('PUBLIC_PREFIXES');

function isPublic(pathname: string): boolean {
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true;
  return publicPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

const RETIRED = '/api/tenant/email/track';
const TOKEN_OPEN = '/api/track/open';
const TOKEN_CLICK = '/api/track/click';

describe('#2526 — the legacy email-track route is retired', () => {
  it('deletes the handler, not just its writes', () => {
    expect(existsSync(join(ROOT, 'app', 'api', 'tenant', 'email', 'track', 'route.ts'))).toBe(false);
  });

  it('leaves the similarly-named authenticated sibling alone', () => {
    // `/api/tenant/email/tracking` is a different route: it lists sent mail for
    // the tenant that owns the session. Deleting `track` must not take it too.
    expect(existsSync(join(ROOT, 'app', 'api', 'tenant', 'email', 'tracking', 'route.ts'))).toBe(true);
    expect(existsSync(join(ROOT, 'app', 'api', 'tenant', 'email', 'analytics', 'route.ts'))).toBe(true);
  });

  it('keeps the tables the two readers still query', () => {
    const schema = src('drizzle/schema/email-tracking.ts');
    expect(schema).toContain('export const emailOpens');
    expect(schema).toContain('export const emailClicks');
  });

  it('never was, and is not now, an anonymous path at the edge', () => {
    expect(isPublic(RETIRED)).toBe(false);
    // Control: the deletion is not the reason the path is closed — the edge
    // gated it while the handler existed, which is why "unauthenticated" in the
    // report was a reading of two doc comments rather than a measurement.
    expect(isPublic(TOKEN_OPEN)).toBe(true);
    expect(isPublic(TOKEN_CLICK)).toBe(true);
  });

  it('does not reappear in PUBLIC_PATHS under any other spelling', () => {
    const spelled = [...proxySource.matchAll(/['"`]\/api\/tenant\/email\/track(?!ing)['"`]/g)];
    expect(spelled).toHaveLength(0);
  });
});

describe('#2526 — the token pair is the ingestion endpoint, and takes no ids', () => {
  const openRoute = src('app/api/track/open/route.ts');
  const clickRoute = src('app/api/track/click/route.ts');

  for (const [name, source] of [
    ['track/open', openRoute],
    ['track/click', clickRoute],
  ] as const) {
    it(`${name} reads only a token, never a caller-supplied tenant, contact or campaign`, () => {
      expect(source).toContain("searchParams.get('t')");
      for (const param of ['tid', 'cid', 'cpid', 'eid', 'tenantId', 'contactId', 'campaignId']) {
        expect(source, `${name} reads ?${param}`).not.toContain(`searchParams.get('${param}')`);
      }
    });
  }

  it('track/click never reads a caller-supplied redirect target', () => {
    // #2218 removed `?url=`; the retired route had kept it behind auth.
    expect(clickRoute).not.toContain("searchParams.get('url')");
    expect(clickRoute).toContain('readClickLinkDestination');
  });

  it('track/click still validates the destination it did register', () => {
    expect(clickRoute).toContain('safeRedirectTarget(');
  });

  it('both scope their writes to the tenant the resolved row names', () => {
    // RLS refuses a write whose tenant_id does not equal app.current_tenant, so
    // an ingestion route that never sets the GUC records nothing silently. The
    // retired route was that bug; these two are the fix.
    expect(openRoute).toMatch(/withTenantContext\(row\.tenantId/);
    expect(clickRoute).toMatch(/withTenantContext\(tracked\.tenantId/);
    expect(openRoute).toContain('withTrackingLookupContext');
    expect(clickRoute).toContain('withTrackingLookupContext');
  });

  it('refuses a malformed token before querying (no redirect oracle)', () => {
    expect(clickRoute).toContain('TRACK_ID_RE');
    expect(openRoute).toContain('emailTracking.deletedAt');
  });
});
