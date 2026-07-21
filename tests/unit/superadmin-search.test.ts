import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: { select: vi.fn() },
}));

vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((_err: unknown, msg: string, status: number) => {
    const { NextResponse } = require('next/server');
    return NextResponse.json({ error: msg }, { status });
  }),
}));

import { GET } from '@/app/api/superadmin/search/route';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { NextRequest, NextResponse } from 'next/server';

function makeRequest(q: string, extra = '') {
  return new NextRequest(`http://localhost/api/superadmin/search?q=${encodeURIComponent(q)}${extra}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: any[]) {
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(result));
  return chain;
}

describe('GET /api/superadmin/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-superadmin users', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: false } as never);
    const res = await GET(makeRequest('test'));
    expect(res.status).toBe(403);
  });

  it('returns the auth response directly when unauthenticated', async () => {
    const authResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue(authResponse);
    const res = await GET(makeRequest('test'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns empty results for short queries', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const res = await GET(makeRequest('a'));
    const body = await res.json();
    expect(body.results).toEqual([]);
  });

  it('trims whitespace before checking query length', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const res = await GET(makeRequest('  a  '));
    const body = await res.json();
    expect(body.results).toEqual([]);
  });

  it('proceeds with the search when the trimmed query is exactly 2 characters', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const tenantChain = makeChain([]);
    const userChain = makeChain([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any).mockImplementationOnce(() => tenantChain).mockImplementationOnce(() => userChain);
    const res = await GET(makeRequest('ab'));
    expect(res.status).toBe(200);
    expect(tenantChain.from).toHaveBeenCalled();
    expect(userChain.from).toHaveBeenCalled();
  });

  it('returns combined tenant and user results for a valid query', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const tenantRows = [{ id: 't1', name: 'Acme', email: 'a@acme.com', status: 'active', type: 'tenant' }];
    const userRows = [{ id: 'u1', name: 'Jane Doe', email: 'jane@example.com', type: 'user' }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any)
      .mockImplementationOnce(() => makeChain(tenantRows))
      .mockImplementationOnce(() => makeChain(userRows));
    const res = await GET(makeRequest('acme'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results).toEqual(expect.arrayContaining([...tenantRows, ...userRows]));
  });

  it('defaults the limit to 10 when not specified', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const tenantChain = makeChain([]);
    const userChain = makeChain([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any).mockImplementationOnce(() => tenantChain).mockImplementationOnce(() => userChain);
    await GET(makeRequest('test'));
    expect(tenantChain.limit).toHaveBeenCalledWith(10);
    expect(userChain.limit).toHaveBeenCalledWith(10);
  });

  it('caps the limit parameter at 25', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const tenantChain = makeChain([]);
    const userChain = makeChain([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any).mockImplementationOnce(() => tenantChain).mockImplementationOnce(() => userChain);
    await GET(makeRequest('test', '&limit=100'));
    expect(tenantChain.limit).toHaveBeenCalledWith(25);
    expect(userChain.limit).toHaveBeenCalledWith(25);
  });

  it('propagates DB errors as 500 instead of silently returning empty', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const dbError = new Error('connection refused');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any).mockImplementation(() => { throw dbError; });
    const res = await GET(makeRequest('test query'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Search failed');
  });

  it('propagates a 500 when only the user query fails (regression for removed .catch)', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const tenantChain = makeChain([{ id: 't1', name: 'Acme', email: 'a@acme.com', status: 'active', type: 'tenant' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userChain: any = {
      from: vi.fn(() => userChain),
      where: vi.fn(() => userChain),
      orderBy: vi.fn(() => userChain),
      limit: vi.fn(() => Promise.reject(new Error('user query failed'))),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any).mockImplementationOnce(() => tenantChain).mockImplementationOnce(() => userChain);
    const res = await GET(makeRequest('test query'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Search failed');
  });
});
