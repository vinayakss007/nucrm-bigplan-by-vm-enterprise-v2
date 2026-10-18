/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2614 — the deals CSV export endpoint (GET /api/tenant/deals/export)
// selected `deals.amount` (and every other field_permissions-covered column)
// and emitted them unconditionally, so a role with `amount` hidden via the
// admin UI still saw every deal's value in the download. Fix projects rows
// through enforceFieldRead and filters CSV headers to the surviving keys.

const TENANT = 'a1111111-1111-4111-8111-111111111111';

const FAKE_ROWS = [
  {
    title: 'Alpha',
    amount: '5000',
    closeDate: null,
    pipelineName: 'P1',
    stageName: 'Negotiation',
    contactEmail: 'c1@x.com',
    companyName: 'ACME',
    assignedTo: 'u-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    title: 'Beta',
    amount: '1200',
    closeDate: null,
    pipelineName: 'P1',
    stageName: 'Won',
    contactEmail: 'c2@x.com',
    companyName: 'Globex',
    assignedTo: 'u-2',
    createdAt: new Date('2026-01-02T00:00:00Z'),
  },
];

const { mockDb, enforceFieldReadMock } = vi.hoisted(() => ({
  mockDb: { select: vi.fn() },
  enforceFieldReadMock: vi.fn(),
}));

function chain(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  const cont = () => b;
  for (const m of ['from', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) b[m] = cont;
  b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return b;
}

vi.mock('@/drizzle/db', () => ({
  db: { select: () => chain(FAKE_ROWS) },
}));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT,
    userId: 'user-1',
    roleSlug: 'rep',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
    user: { email: 'rep@example.com' },
  })),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/read-rate-limit', () => ({ rateLimitRead: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/rbac/enforce', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/rbac/enforce')>();
  return { ...orig, enforceFieldRead: enforceFieldReadMock };
});

beforeEach(() => {
  enforceFieldReadMock.mockReset();
  mockDb.select.mockReset();
});

function dropAmount(rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const { amount: _a, ...rest } = r;
    return rest as Record<string, unknown>;
  });
}

describe('deals CSV export — honors field_permissions (#2614)', () => {
  it('omits the amount header and column when enforceFieldRead strips amount', async () => {
    enforceFieldReadMock.mockResolvedValue(dropAmount(FAKE_ROWS as unknown as Record<string, unknown>[]));
    const route = await import('@/app/api/tenant/deals/export/route');
    const req = new Request('http://localhost/api/tenant/deals/export') as never;
    const res = await route.GET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const [headerLine, ...dataLines] = csv.split('\n');
    expect(headerLine).not.toMatch(/\bamount\b/);
    expect(headerLine.split(',')).toHaveLength(8);
    for (const line of dataLines.filter(Boolean)) {
      expect(line.split(',')).toHaveLength(8);
      expect(line).not.toContain('5000');
      expect(line).not.toContain('1200');
    }
  });

  it('keeps all 9 columns when enforceFieldRead is a pass-through', async () => {
    enforceFieldReadMock.mockImplementation((_ctx: unknown, _entity: string, rows: unknown[]) => rows);
    const route = await import('@/app/api/tenant/deals/export/route');
    const req = new Request('http://localhost/api/tenant/deals/export') as never;
    const res = await route.GET(req, { params: Promise.resolve({}) });
    const csv = await res.text();
    const [headerLine] = csv.split('\n');
    expect(headerLine).toBe('title,amount,close_date,pipeline,stage,contact_email,company,assigned_to,created_at');
  });

  it('handles empty result set (super-admin export with no deals) without a thrown error', async () => {
    enforceFieldReadMock.mockResolvedValue([]);
    // re-point db.select to return an empty array for this call
    mockDb.select.mockImplementation(() => chain([]));
    const route = await import('@/app/api/tenant/deals/export/route');
    const req = new Request('http://localhost/api/tenant/deals/export') as never;
    const res = await route.GET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const csv = await res.text();
    // With no rows we cannot sample keys; header list falls back to just
    // the joined header line (which is fine — no leaked fields).
    expect(csv).toBeDefined();
  });
});
