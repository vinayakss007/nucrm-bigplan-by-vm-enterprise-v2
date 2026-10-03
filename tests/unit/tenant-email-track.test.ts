/**
 * GET /api/tenant/email/track — click-redirect hardening (#2267)
 *
 * Same class as #2218: `?url=` used to flow straight into
 * `NextResponse.redirect(linkUrl)` behind a hand-rolled host blocklist. The
 * fix routes every destination through the shared `safeRedirectTarget()`
 * guard at WRITE time (only a validated string is persisted to
 * `emailClicks.linkUrl`) and redirects only to that validated string. These
 * tests pin: hostile `?url=` is refused with a plain 4xx and never stored or
 * redirected to; javascript:/protocol-relative values can never be persisted;
 * a normal https destination still redirects; and a failing click-tracking
 * write never wedges the redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000';

const tenantQueryMock = vi.fn();
const insertMock = vi.fn();
const rateLimitMock = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => tenantQueryMock(...args),
      }),
    }),
    insert: () => ({
      values: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

vi.mock('@/lib/rate-limit-simple', () => ({
  checkPublicRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

// Any auth/session symbol pulled in transitively must keep resolving; the
// session mock exports BOTH verifyToken and getCurrentUserForToken so no
// module in the chain (lib/auth/middleware, lib/tenant/context, ...) breaks
// on a half-mocked session.
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));

function get(path: string): NextRequest {
  return new Request(`http://localhost${path}`) as unknown as NextRequest;
}

function clickUrl(url: string) {
  return `/api/tenant/email/track?type=click&tid=${TENANT_ID}&url=${encodeURIComponent(url)}`;
}

/** The value handed to `db.insert(emailClicks).values({...})`, if any. */
function persistedClick(): Record<string, unknown> | undefined {
  const call = insertMock.mock.calls[0];
  return call?.[0] as Record<string, unknown> | undefined;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('GET /api/tenant/email/track?type=click (#2267 open redirect)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue(null); // not rate-limited
    tenantQueryMock.mockResolvedValue([{ id: TENANT_ID }]); // tenant exists
    insertMock.mockResolvedValue(undefined); // click write succeeds
  });

  // ── 1. hostile ?url= is never honored (no 302, nothing stored) ────────────

  const HOSTILE = [
    ['javascript:alert(document.cookie)', 'javascript: scheme'],
    ['  javascript:alert(1)  ', 'whitespace-smuggled javascript:'],
    ['java\tscript:alert(1)', 'tab-smuggled javascript:'],
    ['data:text/html,<script>alert(1)</script>', 'data: scheme'],
    ['vbscript:msgbox(1)', 'vbscript: scheme'],
    ['//evil.example.com/phish', 'protocol-relative //host'],
    ['/relative/only', 'relative path'],
    ['http://169.254.169.254/latest/meta-data/', 'link-local metadata (SSRF)'],
    ['http://10.0.0.5/private', 'RFC1918 10/8 (SSRF)'],
    ['http://127.0.0.2/x', 'loopback 127/8 beyond the exact host (missed by the old exact-host blocklist)'],
    ['http://admin:pw@public.example.com/', 'embedded credentials'],
    ['http://localhost:3000/admin', 'localhost'],
    ['http://intranet.internal/x', '.internal suffix'],
  ] as const;

  it.each(HOSTILE)(
    'refuses hostile ?url=%s (%s) with 4xx: no 302 to the attacker, nothing persisted',
    async (hostile) => {
      const { GET } = await import('@/app/api/tenant/email/track/route');
      const res = await GET(get(clickUrl(hostile)));

      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      // #2267 write-time rule: a refused target is never stored as emailClicks.linkUrl
      expect(insertMock).not.toHaveBeenCalled();
    }
  );

  it('does not store or redirect to a raw caller URL that merely parses', async () => {
    // A URL-shaped but unsafe (too long) value must not slip through either.
    const huge = `https://ok.example.com/${'a'.repeat(3000)}`;
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(clickUrl(huge)));

    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  // ── 2. javascript: / //host values can never be STORED ────────────────────

  it.each([
    ['javascript:alert(1)', 'javascript:'],
    ['//evil.example.com/phish', 'protocol-relative'],
    ['data:text/html,x', 'data:'],
  ])('a %s value supplied as ?url= is refused at write time and never persisted', async (hostile) => {
    const { GET } = await import('@/app/api/tenant/email/track/route');
    await GET(get(clickUrl(hostile)));

    // emailClicks.linkUrl only ever receives safeRedirectTarget output; assert
    // no insert call carried the hostile raw string in any position.
    for (const call of insertMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(hostile.slice(0, 20));
    }
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('persists and redirects to the validated (trimmed) form, not the raw parameter', async () => {
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(clickUrl('  https://good.example.com/go  ')));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://good.example.com/go');
    expect(persistedClick()?.linkUrl).toBe('https://good.example.com/go');
  });

  // ── 3. the legitimate behavior is intact ──────────────────────────────────

  it('redirects 302 to a normal https destination and logs the click', async () => {
    const dest = 'https://acme.example.com/offers/42?src=email';
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(
      get(`/api/tenant/email/track?type=click&tid=${TENANT_ID}&cid=c1&cpid=cp1&eid=e1&url=${encodeURIComponent(dest)}`)
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(dest);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(persistedClick()).toMatchObject({
      tenantId: TENANT_ID,
      contactId: 'c1',
      campaignId: 'cp1',
      emailId: 'e1',
      linkUrl: dest,
    });
  });

  it('still redirects 302 to the validated destination when an http (non-tls) public link is used', async () => {
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(clickUrl('http://legacy.example.com/x')));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://legacy.example.com/x');
  });

  it('400s when type=click is given without any url', async () => {
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(`/api/tenant/email/track?type=click&tid=${TENANT_ID}`));

    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  // ── 4. a failed tracking write must not wedge the redirect ────────────────

  it('still redirects safely when the click-tracking write rejects, and reports it through logError', async () => {
    insertMock.mockRejectedValue(new Error('row-level security'));
    const { logError } = await import('@/lib/errors-server');
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(clickUrl('https://good.example.com/go')));
    await flush();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://good.example.com/go');
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'tenant/email/track click-log' })
    );
  });

  it('an insert that throws synchronously also still redirects (no unhandled wedge, no pixel swallow of the click)', async () => {
    insertMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(clickUrl('https://good.example.com/go')));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://good.example.com/go');
  });

  // ── 5. surrounding behavior unchanged ─────────────────────────────────────

  it('returns the tracking pixel and writes nothing when the tenant is unknown', async () => {
    tenantQueryMock.mockResolvedValue([]);
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(clickUrl('https://good.example.com/go')));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns the tracking pixel for open tracking (no type=click)', async () => {
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(`/api/tenant/email/track?tid=${TENANT_ID}&cid=c1`));
    await flush();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
  });

  it('short-circuits with the rate limiter response when the caller is rate-limited', async () => {
    rateLimitMock.mockReturnValue(new Response('too many', { status: 429 }));
    const { GET } = await import('@/app/api/tenant/email/track/route');
    const res = await GET(get(clickUrl('https://good.example.com/go')));

    expect(res.status).toBe(429);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
