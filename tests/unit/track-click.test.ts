import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const findFirstMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
const lookupCalls = vi.fn();
const barePoolCalls = vi.fn();
const tenantContextArgs = vi.fn();
const rateLimitMock = vi.fn();

/** One registered destination, as the sender would have stored it (#2218). */
const STORED = 'https://stored.example.com/go';
const ROW_META = { clickLinks: { offer: STORED } };

/** The transaction both rls helpers hand to their callback. */
const txStub = {
  query: { emailTracking: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
  update: () => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => updateMock(v, ...a) }) }),
  insert: () => ({ values: (...a: unknown[]) => insertMock(...a) }),
};

vi.mock('@/drizzle/db', () => ({
  // The point of 0105: this pool carries no tenant GUC, so reading the
  // tracking row through it is what made every click look forged. Recording
  // the calls lets a regression to `db.query.*` fail loudly here instead of
  // quietly redirecting every real mail link to '/' again.
  db: {
    query: {
      emailTracking: {
        findFirst: (...args: unknown[]) => {
          barePoolCalls();
          return findFirstMock(...args);
        },
      },
    },
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      barePoolCalls();
      return fn(txStub);
    }),
  },
}));

vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: '00000000-0000-0000-0000-000000000000',
  withTrackingLookupContext: (fn: (t: unknown) => Promise<unknown>) => {
    lookupCalls();
    return fn(txStub);
  },
  withTenantContext: (
    tenantId: string,
    userId: string,
    fn: (t: unknown) => Promise<unknown>
  ) => {
    tenantContextArgs(tenantId, userId);
    return fn(txStub);
  },
}));

vi.mock('@/lib/rate-limit-simple', () => ({
  checkPublicRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

function get(path: string) {
  return new Request(`http://localhost${path}`) as unknown as NextRequest;
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';

/** A live row with one registered click destination. */
function rowWithDestination(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    contactId: 'c1',
    tenantId: 'ten1',
    clickCount: 0,
    deletedAt: null,
    metadata: ROW_META,
    ...overrides,
  };
}

/** Let the fire-and-forget tracking write settle. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('GET /api/track/click (#2218 redirect target comes only from the row)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue(null); // not rate-limited
    findFirstMock.mockResolvedValue(null); // no such row
  });

  // ── 1. the destination is the stored one, never the caller's ──────────────

  it('redirects to the destination stored on the row even when a hostile ?url= is supplied', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination());
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(
      get(`/api/track/click?t=${UUID}&l=offer&url=${encodeURIComponent('https://phish.example.com/')}`)
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(STORED);
  });

  it('ignores ?url= entirely: same result with the param absent', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination());
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get(`/api/track/click?t=${UUID}&l=offer`));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(STORED);
  });

  it('uses the single registered destination when the request names no link', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination());
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get(`/api/track/click?t=${UUID}&url=${encodeURIComponent('https://phish.example.com/')}`));

    expect(res.headers.get('location')).toBe(STORED);
  });

  it('lets ?l= pick only among the destinations the sender registered', async () => {
    findFirstMock.mockResolvedValue(
      rowWithDestination({
        metadata: { clickLinks: { a: 'https://a.example.com/x', b: 'https://b.example.com/y' } },
      })
    );
    const { GET } = await import('@/app/api/track/click/route');

    const picked = await GET(get(`/api/track/click?t=${UUID}&l=b`));
    expect(picked.headers.get('location')).toBe('https://b.example.com/y');

    // An unknown link id, and an ambiguous one (two links, no `l`), must not
    // invent a destination: the reader lands on the app root.
    const unknown = await GET(get(`/api/track/click?t=${UUID}&l=nope`));
    expect(unknown.headers.get('location')).toBe('http://localhost/');

    const ambiguous = await GET(get(`/api/track/click?t=${UUID}`));
    expect(ambiguous.headers.get('location')).toBe('http://localhost/');
  });

  it('falls back to the app root when the row registered no destination', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination({ metadata: {} }));
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(
      get(`/api/track/click?t=${UUID}&l=offer&url=${encodeURIComponent('https://phish.example.com/')}`)
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('ignores a destination smuggled in through the row metadata shape', async () => {
    // metadata.clickLinks is a link-id → URL map; a caller cannot reach it
    // except through the sender that wrote the row.
    findFirstMock.mockResolvedValue(rowWithDestination({ metadata: { clickLinks: { offer: 42 } } }));
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get(`/api/track/click?t=${UUID}&l=offer`));
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  // ── 2. the stored destination is still validated ──────────────────────────

  it.each([
    ['javascript:alert(document.cookie)', 'javascript:'],
    ['data:text/html,<script>alert(1)</script>', 'data:'],
    ['//evil.example.com/phish', 'protocol-relative'],
    ['/relative/only', 'relative path'],
    ['http://169.254.169.254/latest/meta-data/', 'link-local (SSRF)'],
  ])('refuses a stored %s destination (%s) and lands on the app root', async (stored) => {
    findFirstMock.mockResolvedValue(rowWithDestination({ metadata: { clickLinks: { offer: stored } } }));
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get(`/api/track/click?t=${UUID}&l=offer`));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('refuses a stored destination whose scheme is smuggled with whitespace', async () => {
    findFirstMock.mockResolvedValue(
      rowWithDestination({ metadata: { clickLinks: { offer: '  javascript:alert(1)  ' } } })
    );
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get(`/api/track/click?t=${UUID}&l=offer`));
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  // ── 3. token lifecycle: 404 / 410, and nothing written ────────────────────

  it('404s for an unknown tracking token and writes nothing', async () => {
    findFirstMock.mockResolvedValue(null);
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(
      get(`/api/track/click?t=${UUID}&url=${encodeURIComponent('https://phish.example.com/')}`)
    );

    expect(res.status).toBe(404);
    await flush();
    expect(lookupCalls).toHaveBeenCalledTimes(1);
    expect(tenantContextArgs).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('404s a malformed token without touching the database, and ignores ?url=', async () => {
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get('/api/track/click?t=not-a-uuid!!!&url=https%3A%2F%2Fevil.example%2F'));

    expect(res.status).toBe(404);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('404s when no token is given at all', async () => {
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get('/api/track/click?url=https%3A%2F%2Fevil.example%2F'));
    expect(res.status).toBe(404);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('410s when the tracking row was soft-deleted', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination({ deletedAt: new Date('2026-01-01T00:00:00Z') }));
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get(`/api/track/click?t=${UUID}&l=offer`));

    expect(res.status).toBe(410);
    await flush();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('redirects home when the row lookup itself fails, instead of 500ing', async () => {
    findFirstMock.mockRejectedValue(new Error('connection terminated'));
    const { logError } = await import('@/lib/errors-server');
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get(`/api/track/click?t=${UUID}&l=offer`));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost/');
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'track/click lookup' })
    );
  });

  // ── 4. the existing lookup + tracking write still work ────────────────────

  it('resolves the row through the tracking-lookup context, not the bare pool (#63)', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination());
    const { GET } = await import('@/app/api/track/click/route');
    await GET(get(`/api/track/click?t=${UUID}&l=offer`));
    await flush();

    expect(lookupCalls).toHaveBeenCalledTimes(1);
    expect(barePoolCalls).not.toHaveBeenCalled();
  });

  it('counts the click and logs the activity as the tenant the row belongs to', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination({ clickCount: 2 }));
    const { GET } = await import('@/app/api/track/click/route');
    await GET(
      get(`/api/track/click?t=${UUID}&l=offer&url=${encodeURIComponent('https://phish.example.com/')}`)
    );
    await flush();

    // A pixel request has no acting user, but the write still has to name the
    // tenant, or RLS refuses it without raising.
    expect(tenantContextArgs).toHaveBeenCalledWith('ten1', '00000000-0000-0000-0000-000000000000');
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const activity = insertMock.mock.calls[0]?.[0] as
      | { tenantId: string; contactId: string; metadata: { url: string | null } }
      | undefined;
    expect(activity).toMatchObject({ tenantId: 'ten1', contactId: 'c1' });
    // The audit row records the server-side destination, never what was typed.
    expect(activity?.metadata.url).toBe(STORED);
  });

  it('still redirects when the tracking write rejects, and reports it through logError', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination());
    updateMock.mockRejectedValue(new Error('row-level security'));
    const { logError } = await import('@/lib/errors-server');
    const { GET } = await import('@/app/api/track/click/route');

    const res = await GET(get(`/api/track/click?t=${UUID}&l=offer`));
    await flush();
    await flush();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(STORED);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'track/click open-tracking' })
    );
  });

  it('suppresses the write but keeps the redirect when the caller is rate-limited', async () => {
    findFirstMock.mockResolvedValue(rowWithDestination());
    rateLimitMock.mockReturnValue(true);
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get(`/api/track/click?t=${UUID}&l=offer`));
    await flush();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(STORED);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
