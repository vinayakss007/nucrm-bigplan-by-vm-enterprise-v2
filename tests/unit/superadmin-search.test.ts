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
import { NextRequest } from 'next/server';

function makeRequest(q: string) {
  return new NextRequest(`http://localhost/api/superadmin/search?q=${encodeURIComponent(q)}`);
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

  it('returns empty results for short queries', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    const res = await GET(makeRequest('a'));
    const body = await res.json();
    expect(body.results).toEqual([]);
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
});
