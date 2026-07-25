/**
 * #666 — API Auth Enforcement Tests
 *
 * Verifies that protected API routes return 401 when called without
 * authentication (mocked requireAuth returns a NextResponse 401).
 *
 * Does NOT import from auth-mock.ts to avoid vi.mock conflicts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { mockDb, mockResolver } from '../helpers/db-mock';

// ── Shared mock setup (must be before vi.mock calls) ──
const mockRequireAuth = vi.fn();
const mockRequirePerm = vi.fn().mockReturnValue(null);

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: mockRequireAuth, requirePerm: mockRequirePerm };
});
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/webhooks', () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/cache', () => ({
  cache: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/dashboard/widget-cache', () => ({
  invalidateWidgetCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/concurrency', () => ({
  withConcurrencyGuard: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/usage/middleware', () => ({
  checkLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/modules/gate', () => ({
  requireModule: vi.fn().mockResolvedValue(null),
}));

// ── Helpers ──
function makeReq(path: string, opts?: RequestInit): NextRequest {
  const headers = new Headers(opts?.headers);
  headers.set('cookie', 'nucrm_session=test-token');
  headers.set('x-forwarded-for', '127.0.0.1');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, 'http://localhost:3000'), { ...opts, headers });
}

function makePostReq(path: string, body: unknown): NextRequest {
  return makeReq(path, { method: 'POST', body: JSON.stringify(body) });
}

// ── Tests ──
describe('API Auth Enforcement (#666)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockResolver(() => []);
  });

  function expect401(res: Response) {
    expect(res.status).toBe(401);
    return res.json().then((b) => expect(b.error).toBeDefined());
  }

  describe('GET /api/tenant/contacts/[id] — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { GET } = await import('@/app/api/tenant/contacts/[id]/route');
      const res = await GET(makeReq('/api/tenant/contacts/c1'), { params: Promise.resolve({ id: 'c1' }) });
      await expect401(res);
    });
  });

  describe('GET /api/tenant/contacts — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));
      await expect401(res);
    });
  });

  describe('GET /api/tenant/deals — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { GET } = await import('@/app/api/tenant/deals/route');
      const res = await GET(makeReq('/api/tenant/deals'));
      await expect401(res);
    });
  });

  describe('GET /api/tenant/tasks — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { GET } = await import('@/app/api/tenant/tasks/route');
      const res = await GET(makeReq('/api/tenant/tasks'));
      await expect401(res);
    });
  });

  describe('GET /api/tenant/companies — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { GET } = await import('@/app/api/tenant/companies/route');
      const res = await GET(makeReq('/api/tenant/companies'));
      await expect401(res);
    });
  });

  describe('GET /api/tenant/tickets — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { GET } = await import('@/app/api/tenant/tickets/route');
      const res = await GET(makeReq('/api/tenant/tickets'));
      await expect401(res);
    });
  });

  describe('PATCH /api/user/profile — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { PATCH } = await import('@/app/api/user/profile/route');
      const res = await PATCH(makeReq('/api/user/profile', { method: 'PATCH', body: JSON.stringify({ name: 'Test' }) }));
      await expect401(res);
    });
  });

  describe('POST /api/tenant/contacts — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { POST } = await import('@/app/api/tenant/contacts/route');
      const res = await POST(makePostReq('/api/tenant/contacts', { first_name: 'Test', email: 'test@example.com' }));
      await expect401(res);
    });
  });

  describe('POST /api/tenant/deals — 401 without token', () => {
    it('returns 401 when requireAuth returns 401', async () => {
      mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));

      const { POST } = await import('@/app/api/tenant/deals/route');
      const res = await POST(makePostReq('/api/tenant/deals', { title: 'Test Deal' }));
      await expect401(res);
    });
  });
});
