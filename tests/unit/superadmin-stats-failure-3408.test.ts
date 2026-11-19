/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — GET /api/superadmin/stats used to end every query with
 * `.catch(() => empty)` so a database outage rendered a confident "0 tenants,
 * 0 active, no errors" platform. A failed read must answer 500 instead of
 * masquerading as a healthy empty workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');
const ROUTE = join(ROOT, 'app/api/superadmin/stats/route.ts');

const { mockDb, mockRequireAuth, mockLogError } = vi.hoisted(() => ({
  mockDb: { select: vi.fn(), execute: vi.fn() },
  mockRequireAuth: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/errors-server', () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: Request, context: C) => unknown) => fn,
}));

beforeEach(() => {
  vi.clearAllMocks();
  // authenticated superadmin
  mockRequireAuth.mockResolvedValue({ userId: 'u-1', isSuperAdmin: true });
  // the isSuperAdmin check query
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ isSuperAdmin: true }]),
  });
});

describe('superadmin stats never reports a failed read as all-clear (#3408)', () => {
  it('no query hides its own failure behind an empty/zeros fallback', () => {
    const src = readFileSync(ROUTE, 'utf8');
    // The six former per-query .catch handlers fabricated data. The only
    // .catch left is none — errors bubble to the outer try/catch (500).
    expect(src).not.toContain("context: 'superadmin/stats platform_stats query'");
    expect(src).not.toContain("context: 'superadmin/stats platformUsage query'");
    expect(src).not.toContain("context: 'superadmin/stats recentTenants query'");
    expect(src).not.toContain('return { rows: [{ data: {} }] }');
    expect(src).not.toContain('totalTenants: 0, activeTenants: 0, trialingTenants: 0');
  });

  it('a rejected head query answers 500, not a zeroed payload', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('DB down'));
    const { GET } = await import('@/app/api/superadmin/stats/route');
    const res = await GET(new Request('http://localhost/api/superadmin/stats'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch platform stats');
    expect(mockLogError).toHaveBeenCalled();
  });
});
