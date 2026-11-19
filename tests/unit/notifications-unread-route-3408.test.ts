/**
 * #3408 — /api/tenant/notifications/unread answered 200 {count:0} on a DB
 * error, so every consumer showed a clean badge over an outage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let whereResult: Promise<unknown>;
const logErrorMock = vi.fn(async () => undefined);
const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => whereResult),
    })),
  })),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: 't1', userId: 'u1' })),
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(h: T) => h }));
vi.mock('@/lib/errors-server', () => ({ logError: (...a: unknown[]) => logErrorMock(...a) }));

const { GET } = await import('@/app/api/tenant/notifications/unread/route');
type Req = import('next/server').NextRequest;
const request = () => new Request('http://localhost/api/tenant/notifications/unread') as unknown as Req;

beforeEach(() => {
  vi.clearAllMocks();
  whereResult = Promise.resolve([{ count: 3 }]);
});

describe('GET /api/tenant/notifications/unread (#3408)', () => {
  it('returns the real count on success', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 3 });
  });

  it('returns an error status when the count cannot be read', async () => {
    whereResult = Promise.reject(new Error('db down'));
    const res = await GET(request());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Could not load unread count');
    expect(body.count).toBeUndefined();
    expect(logErrorMock).toHaveBeenCalled();
  });
});
