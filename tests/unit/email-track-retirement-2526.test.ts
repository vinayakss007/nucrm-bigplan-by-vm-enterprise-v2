/**
 * GET /api/tenant/email/track — retirement (#2526)
 *
 * The endpoint used to take `tid`/`cid`/`cpid`/`eid` and the click target
 * `?url=` from the query string and write `email_opens`/`email_clicks` from
 * them, having proven nothing about any of them. #2526 asks for a per-message
 * capability token or retirement; this suite pins the retirement, because the
 * measurements in the route's own header say there is no working behaviour to
 * preserve (never in `proxy.ts`'s public lists, no in-tree URL generator, and
 * every write refused by RLS because the handler establishes no tenant
 * context).
 *
 * What gives these teeth is the faked `@/drizzle/db`: every case asserts the
 * fake was never touched. Restoring `a1c5e5d0`'s blob turns the suite red on
 * the first case, because the base handler runs a `db.select()` over `tenants`
 * before it answers anything — exactly the query-string-driven read this PR
 * removes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000';

const selectMock = vi.fn();
const insertMock = vi.fn();
const rateLimitMock = vi.fn();
const getPoolMock = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      selectMock(...args);
      return { from: () => ({ where: () => Promise.resolve([]) }) };
    },
    insert: (...args: unknown[]) => {
      insertMock(...args);
      return { values: () => Promise.resolve({}) };
    },
  },
}));

vi.mock('@/lib/db/pool', () => ({ getPool: (...args: unknown[]) => getPoolMock(...args) }));
vi.mock('@/lib/rate-limit-simple', () => ({
  checkPublicRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
// Anything in the import chain that reaches for a session must still resolve.
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));

function callTrack(query = '') {
  return import('@/app/api/tenant/email/track/route').then(({ GET }) =>
    GET(new Request(`http://localhost/api/tenant/email/track${query}`) as unknown as NextRequest));
}

describe('GET /api/tenant/email/track is retired (#2526)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers the legacy pixel shape 410 Gone and never reaches the database', async () => {
    const res = await callTrack(
      `?type=open&tid=${TENANT_ID}&cid=11111111-1111-1111-1111-111111111111`
      + '&cpid=22222222-2222-2222-2222-222222222222&eid=33333333-3333-3333-3333-333333333333');

    expect(res.status).toBe(410);
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it('names the endpoint that does record the event, so a stale link has somewhere to go', async () => {
    const res = await callTrack(`?type=open&tid=${TENANT_ID}`);
    const body = await res.json();

    expect(body.use.open).toContain('/api/track/open');
    expect(body.use.click).toContain('/api/track/click');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('refuses a hostile click target with 410 and no Location, echoing nothing back', async () => {
    const res = await callTrack(
      `?type=click&tid=${TENANT_ID}&url=${encodeURIComponent('javascript:alert(1)')}`);
    const text = await res.text();

    expect(res.status).toBe(410);
    expect(res.headers.get('location')).toBeNull();
    expect(text).not.toContain('javascript:');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('does not redirect a perfectly safe destination either — the redirector is gone', async () => {
    const res = await callTrack(
      `?type=click&tid=${TENANT_ID}&url=${encodeURIComponent('https://example.com/deal/1')}`);

    // #2267 made this branch redirect only to a safeRedirectTarget-approved
    // string. #2526 removes the branch: an https destination is as refused as
    // the javascript: one, because a retired endpoint must not stay a live 302.
    expect(res.status).toBe(410);
    expect(res.headers.get('location')).toBeNull();
  });

  it('answers a bare GET (no query at all) the same way, with JSON not a pixel', async () => {
    const res = await callTrack();

    expect(res.status).toBe(410);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-type')).not.toContain('image/gif');
  });

  describe('the route source itself', () => {
    // Comments in this file *name* the removed calls (that is how the decision
    // stays documented), so the assertions run on the executable scope only —
    // the same comment-stripped evidence `guard:migration-rls` uses for its
    // mitigation reads.
    const code = () => readFileSync(
      join(process.cwd(), 'app/api/tenant/email/track/route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    it('reads no request input and imports no data layer, so re-adding a write is visible', () => {
      const text = code();
      // The handler takes NextRequest for signature compatibility only.
      expect(text).not.toContain('searchParams');
      expect(text).not.toContain('_request.');
      expect(text).not.toContain('@/drizzle/db');
      expect(text).not.toContain('@/drizzle/schema');
      expect(text).not.toContain('emailOpens');
      expect(text).not.toContain('emailClicks');
      expect(text).not.toContain('safeRedirectTarget');
      expect(text).not.toContain('checkPublicRateLimit');
      expect(text).not.toContain('NextResponse.redirect');
    });

    it('the two token-based successors it points callers at still exist', () => {
      expect(existsSync(join(process.cwd(), 'app/api/track/open/route.ts'))).toBe(true);
      expect(existsSync(join(process.cwd(), 'app/api/track/click/route.ts'))).toBe(true);
    });
  });
});
