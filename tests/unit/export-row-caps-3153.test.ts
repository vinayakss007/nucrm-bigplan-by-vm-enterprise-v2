/**
 * #3153 — deals/export and companies/export were the raw-DB twins of the
 * contacts/leads exports without the twin's cap: no LIMIT at all, so a wide
 * filter materialised the whole tenant (plus four joins) into memory. They
 * must fetch MAX_EXPORT_ROWS + 1 and answer 413 like the engine does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  lastLimit: 0,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'leftJoin', 'where', 'orderBy']) chain[m] = () => chain;
      chain.limit = (n: number) => {
        state.lastLimit = n;
        return Promise.resolve(state.rows);
      };
      return chain;
    },
  },
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: 'tenant-1', userId: 'user-1', isSuperAdmin: false }),
  requirePerm: () => null,
  // ownerScope() asks can(ctx, '…view_all'); true keeps the WHERE clause simple.
  can: () => true,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: async (_ctx: unknown, _entity: string, rows: unknown[]) => rows,
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(h: T) => h }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

// MAX_EXPORT_ROWS is computed at module load from EXPORT_MAX_ROWS — set the
// env before importing the routes so the cap is testable without 50k rows.
process.env.EXPORT_MAX_ROWS = '3';

const LIMIT = 3;

function getReq(path: string) {
  return new Request(`http://localhost/${path}`, { method: 'GET' }) as unknown as NextRequest;
}

beforeEach(() => {
  state.rows = [];
  state.lastLimit = 0;
});

describe('#3153 deals/export caps the read and answers 413 on overflow', () => {
  it('413s with the engine message when the probe row comes back', async () => {
    const { GET } = await import('@/app/api/tenant/deals/export/route');
    state.rows = Array.from({ length: LIMIT + 1 }, (_, i) => ({ title: `d${i}` }));
    const res = await GET(getReq('api/tenant/deals/export'));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain(`maximum of ${LIMIT} rows`);
  });

  it('serves the CSV and pins the +1 probe limit when within range', async () => {
    const { GET } = await import('@/app/api/tenant/deals/export/route');
    state.rows = [{ title: 'Deal', amount: '10', closeDate: null, pipelineName: null, stageName: null, contactEmail: null, companyName: null, assignedTo: null, createdAt: new Date(0) }];
    const res = await GET(getReq('api/tenant/deals/export'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(state.lastLimit).toBe(LIMIT + 1);
  });
});

describe('#3153 companies/export caps the read and answers 413 on overflow', () => {
  it('413s with the engine message when the probe row comes back', async () => {
    const { GET } = await import('@/app/api/tenant/companies/export/route');
    state.rows = Array.from({ length: LIMIT + 1 }, (_, i) => ({ name: `c${i}` }));
    const res = await GET(getReq('api/tenant/companies/export'));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain(`maximum of ${LIMIT} rows`);
  });

  it('serves the CSV and pins the +1 probe limit when within range', async () => {
    const { GET } = await import('@/app/api/tenant/companies/export/route');
    state.rows = [{ name: 'Acme', domain: null, industry: null, phone: null, address: null, city: null, state: null, country: null, postalCode: null, numberOfEmployees: null, annualRevenue: null, notes: null, tags: [], createdAt: new Date(0) }];
    const res = await GET(getReq('api/tenant/companies/export'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(state.lastLimit).toBe(LIMIT + 1);
  });
});
