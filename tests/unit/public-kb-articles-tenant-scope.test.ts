/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2221 — GET /api/public/kb/articles filtered only on status='published'
 * with no tenant scoping, so every tenant's published knowledge base was
 * globally cross-enumerable from one anonymous call. kb_articles rows carry
 * a tenantId and the only consumer is the customer portal, so the list is
 * now scoped to the caller's server-validated portal identity
 * (resolvePortalIdentity — cookie or x-portal-token, same mechanism as
 * /api/public/tickets); anonymous callers get 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

type Marker = { op: string; args: unknown[] };

const { mockResolvePortalIdentity, captured } = vi.hoisted(() => ({
  mockResolvePortalIdentity: vi.fn(),
  captured: { where: undefined as unknown, selectCalls: 0 },
}));

const mk = (op: string) => (...args: unknown[]): Marker => ({ op, args });
const colName = (c: unknown) => (c as { name?: string })?.name;

function setup() {
  vi.resetModules();
  captured.where = undefined;
  captured.selectCalls = 0;
  mockResolvePortalIdentity.mockReset();

  // Keep the real drizzle-orm (schema files build tables at import time) but
  // override the operators this route uses so the composed where-clause is
  // inspectable (pattern: tests/unit/leads-route-filters.test.ts).
  vi.doMock('drizzle-orm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('drizzle-orm')>();
    return { ...actual, eq: mk('eq'), and: mk('and'), desc: mk('desc'), isNull: mk('isNull') };
  });

  vi.doMock('@/lib/portal-auth', () => ({
    resolvePortalIdentity: (...args: unknown[]) => mockResolvePortalIdentity(...args),
  }));

  const rows = [{ id: 'art-1', title: 'How to export', slug: 'how-to-export' }];
  vi.doMock('@/drizzle/db', () => ({
    db: {
      select: () => {
        captured.selectCalls += 1;
        const chain: Record<string, unknown> = {
          from: () => chain,
          leftJoin: () => chain,
          where: (arg: unknown) => { captured.where = arg; return chain; },
          orderBy: () => chain,
          limit: () => Promise.resolve(rows),
        };
        return chain;
      },
    },
  }));
}

async function callGet(headers: Record<string, string> = {}) {
  const { GET } = await import('@/app/api/public/kb/articles/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/public/kb/articles', { headers });
  return GET(req);
}

function whereArgs(): Marker[] {
  expect(captured.where).toBeDefined();
  const where = captured.where as Marker;
  expect(where.op).toBe('and');
  return where.args as Marker[];
}

describe('GET /api/public/kb/articles — portal tenant scoping (#2221)', () => {
  beforeEach(setup);

  it('rejects anonymous callers with 401 instead of cross-enumerating every tenant KB', async () => {
    mockResolvePortalIdentity.mockResolvedValue(null);
    const res = await callGet();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
    expect(captured.selectCalls).toBe(0);
  });

  it('scopes published articles to the validated portal tenant (+ status & soft-delete filters kept)', async () => {
    mockResolvePortalIdentity.mockResolvedValue({ email: 'a@b.c', tenantId: TENANT_A });
    const res = await callGet({ 'x-portal-token': 'opaque-token' });
    expect(res.status).toBe(200);

    const filters = whereArgs();
    const tenantFilter = filters.find(f => f.op === 'eq' && colName(f.args[0]) === 'tenant_id');
    expect(tenantFilter).toBeDefined();
    expect(tenantFilter!.args[1]).toBe(TENANT_A);
    const statusFilter = filters.find(f => f.op === 'eq' && colName(f.args[0]) === 'status');
    expect(statusFilter!.args[1]).toBe('published');
    expect(filters.some(f => f.op === 'isNull')).toBe(true);
  });

  it('keeps the { data: [...] } response shape the portal UI consumes', async () => {
    mockResolvePortalIdentity.mockResolvedValue({ email: 'a@b.c', tenantId: TENANT_A });
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ id: 'art-1', title: 'How to export', slug: 'how-to-export' }]);
  });
});
