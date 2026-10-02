/**
 * GET /api/track/open — the 1x1 pixel (#63)
 *
 * The whole value of open tracking is that a request from a mail client, which
 * carries no session and therefore no tenant GUC, still resolves the tracking
 * row. `email_tracking` used to have only `tenant_isolation`, so that read
 * matched nothing: the endpoint answered the GIF and recorded nothing at all,
 * with no error to show for it. These tests pin the two contexts the fix needs
 * — a narrow lookup read, then a write scoped to the tenant the row named —
 * because falling back to the bare pool reproduces the silent zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TRACK_URL = '/api/track/open?t=123e4567-e89b-12d3-a456-426614174000';
const NIL_USER = '00000000-0000-0000-0000-000000000000';

const findFirstMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
const lookupCalls = vi.fn();
const barePoolCalls = vi.fn();
const tenantContextArgs = vi.fn();
const rateLimitedMock = vi.fn(() => false);

const txStub = {
  query: { emailTracking: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
  update: () => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => updateMock(v, ...a) }) }),
  insert: () => ({ values: (...a: unknown[]) => insertMock(...a) }),
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      emailTracking: {
        findFirst: (...args: unknown[]) => {
          barePoolCalls();
          return findFirstMock(...args);
        },
      },
    },
    transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      barePoolCalls();
      return fn(txStub);
    }),
  },
}));

vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: NIL_USER,
  withTrackingLookupContext: (fn: (t: unknown) => Promise<unknown>) => {
    lookupCalls();
    return fn(txStub);
  },
  withTenantContext: (tenantId: string, userId: string, fn: (t: unknown) => Promise<unknown>) => {
    tenantContextArgs(tenantId, userId);
    return fn(txStub);
  },
}));

vi.mock('@/lib/rate-limit-simple', () => ({
  checkPublicRateLimit: () => rateLimitedMock(),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

function get(path: string) {
  return new Request(`http://localhost${path}`) as unknown as NextRequest;
}

/** The pixel write is fire-and-forget; yield so it runs before asserting. */
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * Render a drizzle `sql` template towards the text it will send. Nested column
 * references come back as objects and are not expanded here — enough to see the
 * arithmetic the route asked Postgres to do.
 */
function sqlText(node: unknown): string {
  const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map((chunk) =>
      typeof chunk === 'string' ? chunk : String((chunk as { value?: unknown } | null)?.value ?? '')
    )
    .join('');
}

describe('GET /api/track/open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
    rateLimitedMock.mockReturnValue(false);
  });

  it('answers the GIF even for a request with no tracking id, and writes nothing', async () => {
    const { GET } = await import('@/app/api/track/open/route');
    const res = await GET(get('/api/track/open'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    await settle();
    expect(lookupCalls).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('resolves the row through the tracking-lookup context, not the bare pool', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: 'c1', tenantId: 'ten1', openCount: 0 });
    const { GET } = await import('@/app/api/track/open/route');
    const res = await GET(get(TRACK_URL));

    expect(res.headers.get('content-type')).toBe('image/gif');
    await settle();
    expect(lookupCalls).toHaveBeenCalledTimes(1);
    expect(barePoolCalls).not.toHaveBeenCalled();
  });

  it('counts the open as the tenant the row belongs to', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: 'c1', tenantId: 'ten1', openCount: 0 });
    const { GET } = await import('@/app/api/track/open/route');
    await GET(get(TRACK_URL));
    await settle();

    expect(tenantContextArgs).toHaveBeenCalledWith('ten1', NIL_USER);
    expect(updateMock).toHaveBeenCalledTimes(1);
    // open_count is incremented in SQL, never from the value this request read.
    const set = updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(sqlText(set.openCount)).toContain('+ 1');
    expect(sqlText(set.openedAt)).toContain('COALESCE');
  });

  it('logs the "Email opened" activity on the first open only', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: 'c1', tenantId: 'ten1', openCount: 0 });
    const { GET } = await import('@/app/api/track/open/route');
    await GET(get(TRACK_URL));
    await settle();

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      tenantId: 'ten1',
      contactId: 'c1',
      eventType: 'email',
      action: 'email_open',
    });
  });

  it('does not re-log the activity for a repeat open', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: 'c1', tenantId: 'ten1', openCount: 4 });
    const { GET } = await import('@/app/api/track/open/route');
    await GET(get(TRACK_URL));
    await settle();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('still returns the pixel when the write is rate-limited', async () => {
    findFirstMock.mockResolvedValue({ id: 't1', contactId: 'c1', tenantId: 'ten1', openCount: 0 });
    rateLimitedMock.mockReturnValue(true);
    const { GET } = await import('@/app/api/track/open/route');
    const res = await GET(get(TRACK_URL));

    expect(res.status).toBe(200);
    await settle();
    expect(lookupCalls).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('writes nothing for an unknown tracking id', async () => {
    findFirstMock.mockResolvedValue(null);
    const { GET } = await import('@/app/api/track/open/route');
    const res = await GET(get(TRACK_URL));

    expect(res.status).toBe(200);
    await settle();
    expect(lookupCalls).toHaveBeenCalledTimes(1);
    expect(tenantContextArgs).not.toHaveBeenCalled();
  });
});
