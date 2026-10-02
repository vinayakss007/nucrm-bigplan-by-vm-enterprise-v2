import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const findFirstMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
const lookupCalls = vi.fn();
const barePoolCalls = vi.fn();
const tenantContextArgs = vi.fn();

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
  checkPublicRateLimit: vi.fn(() => false),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

function get(path: string) {
  return new Request(`http://localhost${path}`) as unknown as NextRequest;
}

describe('GET /api/track/click (#1981 open-redirect gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
  });

  it('redirects to / when no tracking id is given', async () => {
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get('/api/track/click?url=https%3A%2F%2Fevil.example%2F'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost/');
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('redirects to / for a forged tracking id even with a clean URL', async () => {
    findFirstMock.mockResolvedValue(null); // no such row
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(
      get('/api/track/click?t=123e4567-e89b-12d3-a456-426614174000&url=https%3A%2F%2Fevil.example%2F')
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('redirects to / for a malformed tracking id', async () => {
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(get('/api/track/click?t=not-a-uuid!!!&url=https%3A%2F%2Fevil.example%2F'));
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('honors the destination for a real tracking row', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: 'c1', tenantId: 'ten1', clickCount: 0 });
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(
      get('/api/track/click?t=123e4567-e89b-12d3-a456-426614174000&url=https%3A%2F%2Fexample.com%2Fpage')
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/page');
  });

  it('still blocks SSRF destinations for real rows', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: null, tenantId: 'ten1', clickCount: 0 });
    const { GET } = await import('@/app/api/track/click/route');
    const res = await GET(
      get('/api/track/click?t=123e4567-e89b-12d3-a456-426614174000&url=http%3A%2F%2F169.254.169.254%2F')
    );
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('resolves the row through the tracking-lookup context, not the bare pool (#63)', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: 'c1', tenantId: 'ten1', clickCount: 0 });
    const { GET } = await import('@/app/api/track/click/route');
    await GET(
      get('/api/track/click?t=123e4567-e89b-12d3-a456-426614174000&url=https%3A%2F%2Fexample.com%2Fpage')
    );
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget write run

    expect(lookupCalls).toHaveBeenCalledTimes(1);
    expect(barePoolCalls).not.toHaveBeenCalled();
  });

  it('counts the click and logs the activity as the tenant the row belongs to', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: 'c1', tenantId: 'ten1', clickCount: 2 });
    const { GET } = await import('@/app/api/track/click/route');
    await GET(
      get('/api/track/click?t=123e4567-e89b-12d3-a456-426614174000&url=https%3A%2F%2Fexample.com%2Fpage')
    );
    await new Promise((r) => setTimeout(r, 0));

    // A pixel request has no acting user, but the write still has to name the
    // tenant, or RLS refuses it without raising.
    expect(tenantContextArgs).toHaveBeenCalledWith('ten1', '00000000-0000-0000-0000-000000000000');
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ tenantId: 'ten1', contactId: 'c1' });
  });

  it('writes nothing when no tracking row matches', async () => {
    findFirstMock.mockResolvedValue(null);
    const { GET } = await import('@/app/api/track/click/route');
    await GET(
      get('/api/track/click?t=123e4567-e89b-12d3-a456-426614174000&url=https%3A%2F%2Fexample.com%2Fpage')
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(lookupCalls).toHaveBeenCalledTimes(1);
    expect(tenantContextArgs).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
