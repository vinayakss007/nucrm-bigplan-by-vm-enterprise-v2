import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const findFirstMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      emailTracking: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
    },
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        update: () => ({ set: () => ({ where: (...a: unknown[]) => updateMock(...a) }) }),
        insert: () => ({ values: (...a: unknown[]) => insertMock(...a) }),
      })
    ),
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
});
