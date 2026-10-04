/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2284 — GET /api/public/kb/articles/[id] filtered only on
 * status='published' + the raw uuid, with no tenant scoping, so anyone who
 * guessed an article uuid could read another tenant's KB row (the list
 * endpoint was closed in #2221 / PR #2283, the detail endpoint stayed open).
 * The detail route now mirrors the list predicate exactly:
 * resolvePortalIdentity (cookie or x-portal-token) -> anonymous 401, and
 * WHERE tenant_id = identity.tenantId AND status = 'published' AND
 * deleted_at IS NULL. Anything unmatched (other tenant, draft, archived,
 * soft-deleted, missing) gets an identical 404 with no row content — never a
 * 403, so the route is not an existence oracle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const ARTICLE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SECRET_CONTENT = 'SENSITIVE-DRAFT-BODY-LEAK-CANARY';

type Marker = { op: string; args: unknown[] };

const { mockResolvePortalIdentity, captured } = vi.hoisted(() => ({
  mockResolvePortalIdentity: vi.fn(),
  captured: {
    where: undefined as unknown,
    selectCalls: 0,
    rows: [] as unknown[],
    updates: [] as { setArg: unknown; where: unknown }[],
  },
}));

const mk = (op: string) => (...args: unknown[]): Marker => ({ op, args });
const colName = (c: unknown) => (c as { name?: string })?.name;

function setup() {
  vi.resetModules();
  captured.where = undefined;
  captured.selectCalls = 0;
  captured.rows = [{
    id: ARTICLE_ID,
    title: 'How to export',
    slug: 'how-to-export',
    content: SECRET_CONTENT,
    excerpt: 'excerpt text',
    views: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    categoryName: 'Guides',
  }];
  captured.updates = [];
  mockResolvePortalIdentity.mockReset();

  // Keep the real drizzle-orm (schema files build tables at import time) but
  // override the operators this route uses so the composed where-clause is
  // inspectable (pattern: tests/unit/public-kb-articles-tenant-scope.test.ts).
  vi.doMock('drizzle-orm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('drizzle-orm')>();
    return { ...actual, eq: mk('eq'), and: mk('and'), isNull: mk('isNull') };
  });

  vi.doMock('@/lib/portal-auth', () => ({
    resolvePortalIdentity: (...args: unknown[]) => mockResolvePortalIdentity(...args),
  }));

  vi.doMock('@/drizzle/db', () => ({
    db: {
      select: () => {
        captured.selectCalls += 1;
        const chain: Record<string, unknown> = {
          from: () => chain,
          leftJoin: () => chain,
          where: (arg: unknown) => { captured.where = arg; return chain; },
          limit: () => Promise.resolve(captured.rows),
        };
        return chain;
      },
      update: () => ({
        set: (setArg: unknown) => ({
          where: (whereArg: unknown) => {
            captured.updates.push({ setArg, where: whereArg });
            return Promise.resolve([]);
          },
        }),
      }),
    },
  }));
}

async function callGet(headers: Record<string, string> = {}) {
  const { GET } = await import('@/app/api/public/kb/articles/[id]/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(`http://localhost/api/public/kb/articles/${ARTICLE_ID}`, { headers });
  return GET(req, { params: Promise.resolve({ id: ARTICLE_ID }) });
}

function whereArgs(): Marker[] {
  expect(captured.where).toBeDefined();
  const where = captured.where as Marker;
  expect(where.op).toBe('and');
  return where.args as Marker[];
}

describe('GET /api/public/kb/articles/[id] — portal tenant scoping (#2284)', () => {
  beforeEach(setup);

  it('rejects anonymous callers with 401 and never queries the table', async () => {
    mockResolvePortalIdentity.mockResolvedValue(null);
    const res = await callGet();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
    expect(captured.selectCalls).toBe(0);
    expect(captured.updates).toHaveLength(0);
  });

  it('returns a published same-tenant article with the unchanged { data: article } shape', async () => {
    mockResolvePortalIdentity.mockResolvedValue({ email: 'a@b.c', tenantId: TENANT_A });
    const res = await callGet({ 'x-portal-token': 'opaque-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(captured.rows[0]);
    expect(captured.updates).toHaveLength(1); // views bump only on a matched row
  });

  it('scopes the by-id lookup with the list-route predicate: tenant_id + status + soft-delete', async () => {
    mockResolvePortalIdentity.mockResolvedValue({ email: 'a@b.c', tenantId: TENANT_A });
    const res = await callGet();
    expect(res.status).toBe(200);

    const filters = whereArgs();
    const idFilter = filters.find(f => f.op === 'eq' && colName(f.args[0]) === 'id');
    expect(idFilter).toBeDefined();
    expect(idFilter!.args[1]).toBe(ARTICLE_ID);
    const tenantFilter = filters.find(f => f.op === 'eq' && colName(f.args[0]) === 'tenant_id');
    expect(tenantFilter).toBeDefined();
    expect(tenantFilter!.args[1]).toBe(TENANT_A);
    const statusFilter = filters.find(f => f.op === 'eq' && colName(f.args[0]) === 'status');
    expect(statusFilter).toBeDefined();
    expect(statusFilter!.args[1]).toBe('published');
    const softDelete = filters.find(f => f.op === 'isNull');
    expect(softDelete).toBeDefined();
    expect(colName(softDelete!.args[0])).toBe('deleted_at');
  });

  it('cross-state access (draft / other tenant / deleted row) -> 404 with zero row content leaked and no views bump', async () => {
    // The scoped WHERE makes such rows simply not match: db returns [].
    mockResolvePortalIdentity.mockResolvedValue({ email: 'a@b.c', tenantId: TENANT_A });
    captured.rows = [];
    const res = await callGet();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
    expect(JSON.stringify(body)).not.toContain(SECRET_CONTENT);
    expect(captured.updates).toHaveLength(0);
  });

  it('still 404s (not 403/500) when the identity resolves but the id is unknown', async () => {
    mockResolvePortalIdentity.mockResolvedValue({ email: 'a@b.c', tenantId: TENANT_A });
    captured.rows = [];
    const res = await callGet({ 'x-portal-token': 'opaque-token' });
    expect(res.status).toBe(404);
  });
});
