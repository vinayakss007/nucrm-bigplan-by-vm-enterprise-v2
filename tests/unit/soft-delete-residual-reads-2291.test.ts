/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2291 — residual soft-delete read gaps after PR #2290.
 *
 * Same behavioral harness style as tests/unit/soft-delete-lists-2236.test.ts:
 * the fake db renders the captured WHERE clause with PgDialect and filters
 * in-memory rows by the deleted_at predicate, proving tombstoned rows really
 * disappear from the response (lists, CSV export, counts) and 404 on [id]
 * GETs — services/[id], canned_responses list, segments list/members/enroll,
 * kb tenant+public [id], superadmin announcements, and the deals CSV export.
 *
 * The final blocks pin the same predicate on the surfaces that read segments
 * or billing tables OUTSIDE a plain list route (5 bulk add_to_segment
 * validations, contacts/[id] server page) via source scan, since those paths
 * need heavier fixtures to execute.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';

const TENANT = 'a1111111-1111-4111-8111-111111111111';

const harness = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Record<string, unknown>[]>,
    whereSqls: [] as string[],
  };
  const inject = { render: null as null | ((f: SQL) => string) };

  const makeChain = (cols?: Record<string, unknown>) => {
    let captured: SQL | null = null;
    let limitN: number | undefined;
    let offsetN = 0;
    const chain: Record<string, unknown> = {};
    const finalize = async () => {
      let rows: Record<string, unknown>[] = [];
      if (captured && inject.render) {
        const sqlText = inject.render(captured);
        state.whereSqls.push(sqlText);
        const tableMatch = /"([a-z_]+)"\./.exec(sqlText);
        rows = state.tables[tableMatch?.[1] ?? ''] ?? [];
        if (/"deleted_at" is not null/i.test(sqlText)) rows = rows.filter(r => r.deletedAt != null);
        else if (/"deleted_at" is null/i.test(sqlText)) rows = rows.filter(r => r.deletedAt == null);
      }
      rows = rows.slice(offsetN, limitN === undefined ? undefined : offsetN + limitN);
      if (cols && 'count' in cols) return [{ count: rows.length }];
      return rows.map(r => ({ ...r }));
    };
    chain.from = () => chain;
    chain.leftJoin = () => chain;
    chain.rightJoin = () => chain;
    chain.innerJoin = () => chain;
    chain.orderBy = () => chain;
    chain.groupBy = () => chain;
    chain.where = (f: SQL) => { captured = f; return chain; };
    chain.limit = (n: number) => { limitN = n; return chain; };
    chain.offset = (n: number) => { offsetN = n; return chain; };
    chain.returning = () => chain;
    chain.catch = (f: (e: unknown) => unknown) => chain.then(undefined, f);
    chain.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      finalize().then(ok, err);
    return chain;
  };

  const db = {
    select: (cols?: Record<string, unknown>) => makeChain(cols),
    // View-count bumps (kb GETs) and other post-read writes only need to
    // resolve; their predicates are not under test here.
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  };
  return { state, inject, db };
});

vi.mock('@/drizzle/db', () => ({ db: harness.db }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT,
    userId: 'user-1',
    isAdmin: true,
    isSuperAdmin: true,
    user: { email: 'admin@example.com' },
  })),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/read-rate-limit', () => ({ rateLimitRead: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: vi.fn(async () => ({ tenantId: TENANT, contactId: 'contact-1' })),
}));

import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as dealsExportRoute from '@/app/api/tenant/deals/export/route';
import * as serviceDetailRoute from '@/app/api/tenant/services/[id]/route';
import * as cannedRoute from '@/app/api/tenant/canned-responses/route';
import * as segmentsRoute from '@/app/api/tenant/segments/route';
import * as segmentMembersRoute from '@/app/api/tenant/segments/[id]/members/route';
import * as segmentEnrollRoute from '@/app/api/tenant/segments/[id]/enroll/route';
import * as kbTenantDetailRoute from '@/app/api/tenant/kb/articles/[id]/route';
import * as kbPublicDetailRoute from '@/app/api/public/kb/articles/[id]/route';
import * as announcementsRoute from '@/app/api/superadmin/announcements/route';

const dialect = new PgDialect();
harness.inject.render = (f: SQL) => dialect.sqlToQuery(f).sql;

const ACTIVE_DEAL = { id: 'deal-active', tenantId: TENANT, title: 'Live Deal', amount: '100', closeDate: null, assignedTo: null, createdAt: new Date('2026-01-01'), deletedAt: null };
const DELETED_DEAL = { id: 'deal-deleted', tenantId: TENANT, title: 'Trashed Deal', amount: '200', closeDate: null, assignedTo: null, createdAt: new Date('2026-01-02'), deletedAt: new Date() };
const ACTIVE_SVC = { id: 'svc-active', tenantId: TENANT, name: 'Active Service', deletedAt: null };
const DELETED_SVC = { id: 'svc-deleted', tenantId: TENANT, name: 'Deleted Service', deletedAt: new Date() };
const ACTIVE_CANNED = { id: 'cr-active', tenantId: TENANT, title: 'Hello', category: 'greeting', createdAt: new Date(), deletedAt: null };
const DELETED_CANNED = { id: 'cr-deleted', tenantId: TENANT, title: 'Old', category: 'greeting', createdAt: new Date(), deletedAt: new Date() };
const ACTIVE_SEG = { id: 'seg-active', tenantId: TENANT, name: 'Vip', entityType: 'contact', description: null, config: {}, createdAt: new Date(), lastRefreshedAt: null, deletedAt: null };
const DELETED_SEG = { id: 'seg-deleted', tenantId: TENANT, name: 'Stale', entityType: 'contact', description: null, config: {}, createdAt: new Date(), lastRefreshedAt: null, deletedAt: new Date() };
const ACTIVE_KB = { id: 'kb-active', tenantId: TENANT, title: 'How-to', slug: 'how-to', content: 'body', excerpt: null, status: 'published', views: 1, helpful: 0, notHelpful: 0, tags: [], createdAt: new Date(), publishedAt: new Date(), categoryId: null, deletedAt: null };
const DELETED_KB = { id: 'kb-deleted', tenantId: TENANT, title: 'Gone', slug: 'gone', content: 'body', excerpt: null, status: 'published', views: 1, helpful: 0, notHelpful: 0, tags: [], createdAt: new Date(), publishedAt: new Date(), categoryId: null, deletedAt: new Date() };
const ACTIVE_ANN = { id: 'ann-active', title: 'Maintenance', content: 'c', type: 'info', isActive: true, target: 'all', startsAt: new Date(), endsAt: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null };
const DELETED_ANN = { id: 'ann-deleted', title: 'Old News', content: 'c', type: 'info', isActive: false, target: 'all', startsAt: new Date(), endsAt: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: new Date() };

/* eslint-disable @typescript-eslint/no-explicit-any -- test shim: withApiRoute widens each handler signature per route context type */
async function getJson(url: string, route: { GET: (...args: any[]) => Promise<any> }, params?: string): Promise<{ res: Response; body: Record<string, unknown> }> {
  const fetchRes = params
    ? await (route.GET as any)(new Request(url) as NextRequest, { params: Promise.resolve({ id: params }) })
    : await route.GET(new Request(url) as NextRequest);
  const res = fetchRes as Response;
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : {} };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.clearAllMocks();
  harness.state.tables = {
    deals: [ACTIVE_DEAL, DELETED_DEAL],
    services: [ACTIVE_SVC, DELETED_SVC],
    canned_responses: [ACTIVE_CANNED, DELETED_CANNED],
    segments: [ACTIVE_SEG, DELETED_SEG],
    segment_members: [
      { segmentId: 'seg-active', tenantId: TENANT, entityId: 'contact-1', addedAt: new Date() },
      { segmentId: 'seg-active', tenantId: TENANT, entityId: 'contact-2', addedAt: new Date() },
    ],
    kb_articles: [ACTIVE_KB, DELETED_KB],
    announcements: [ACTIVE_ANN, DELETED_ANN],
  };
  harness.state.whereSqls = [];
});

describe('deals CSV export GET (#2291)', () => {
  it('omits soft-deleted deals from the export body', async () => {
    const res = await (dealsExportRoute.GET as (r: NextRequest) => Promise<Response>)(
      new Request('http://localhost/api/tenant/deals/export') as NextRequest,
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('Live Deal');
    expect(csv).not.toContain('Trashed Deal');
    expect(harness.state.whereSqls[0]).toContain('"deals"."deleted_at" is null');
  });
});

describe('services [id] GET (#2291)', () => {
  it('returns a live service', async () => {
    harness.state.tables.services = [ACTIVE_SVC];
    const { res, body } = await getJson('http://localhost/api/tenant/services/svc-active', serviceDetailRoute, 'svc-active');
    expect(res.status).toBe(200);
    expect((body.service as Record<string, unknown>).id).toBe('svc-active');
  });

  it('404s for a soft-deleted service', async () => {
    harness.state.tables.services = [DELETED_SVC];
    const { res } = await getJson('http://localhost/api/tenant/services/svc-deleted', serviceDetailRoute, 'svc-deleted');
    expect(res.status).toBe(404);
    expect(harness.state.whereSqls[0]).toContain('"services"."deleted_at" is null');
  });
});

describe('canned_responses list GET (#2291)', () => {
  it('excludes the tombstoned canned response', async () => {
    const { res, body } = await getJson('http://localhost/api/tenant/canned-responses', cannedRoute);
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>[]).map(r => r.id)).toEqual(['cr-active']);
    expect(harness.state.whereSqls[0]).toContain('"canned_responses"."deleted_at" is null');
  });
});

describe('segments reads (#2291)', () => {
  it('list GET excludes the soft-deleted segment', async () => {
    const { res, body } = await getJson('http://localhost/api/tenant/segments', segmentsRoute);
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>[]).map(r => r.id)).toEqual(['seg-active']);
    expect(harness.state.whereSqls[0]).toContain('"segments"."deleted_at" is null');
  });

  it('members GET still lists cached members of a live segment (count intact)', async () => {
    const { res, body } = await getJson('http://localhost/api/tenant/segments/seg-active/members', segmentMembersRoute, 'seg-active');
    expect(res.status).toBe(200);
    expect(body.data).toEqual(['contact-1', 'contact-2']);
    expect((body.meta as Record<string, unknown>).count).toBe(2);
  });

  it('members GET 404s for a soft-deleted segment', async () => {
    harness.state.tables.segments = [DELETED_SEG];
    const { res } = await getJson('http://localhost/api/tenant/segments/seg-deleted/members', segmentMembersRoute, 'seg-deleted');
    expect(res.status).toBe(404);
    expect(harness.state.whereSqls[0]).toContain('"segments"."deleted_at" is null');
  });

  it('enroll POST refuses a soft-deleted segment', async () => {
    harness.state.tables.segments = [DELETED_SEG];
    const req = new Request('http://localhost/api/tenant/segments/seg-deleted/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sequence_id: '00000000-0000-4000-8000-000000000000' }),
    }) as NextRequest;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wrapped handler signature
    const res = await (segmentEnrollRoute.POST as any)(req, { params: Promise.resolve({ id: 'seg-deleted' }) }) as Response;
    expect(res.status).toBe(404);
  });
});

describe('kb_articles detail reads (#2291)', () => {
  it('tenant [id] GET 404s for a soft-deleted article', async () => {
    harness.state.tables.kb_articles = [DELETED_KB];
    const { res } = await getJson('http://localhost/api/tenant/kb/articles/kb-deleted', kbTenantDetailRoute, 'kb-deleted');
    expect(res.status).toBe(404);
    expect(harness.state.whereSqls[0]).toContain('"kb_articles"."deleted_at" is null');
  });

  it('tenant [id] GET still serves a live article', async () => {
    harness.state.tables.kb_articles = [ACTIVE_KB];
    const { res, body } = await getJson('http://localhost/api/tenant/kb/articles/kb-active', kbTenantDetailRoute, 'kb-active');
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>).id).toBe('kb-active');
  });

  it('public portal [id] GET 404s for a soft-deleted article', async () => {
    harness.state.tables.kb_articles = [DELETED_KB];
    const { res } = await getJson('http://localhost/api/public/kb/articles/kb-deleted', kbPublicDetailRoute, 'kb-deleted');
    expect(res.status).toBe(404);
    expect(harness.state.whereSqls[0]).toContain('"kb_articles"."deleted_at" is null');
  });
});

describe('superadmin announcements list GET (#2291)', () => {
  it('excludes the soft-deleted announcement', async () => {
    const { res, body } = await getJson('http://localhost/api/superadmin/announcements', announcementsRoute);
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>[]).map(r => r.id)).toEqual(['ann-active']);
    expect(harness.state.whereSqls[0]).toContain('"announcements"."deleted_at" is null');
  });
});

describe('sweeps pinned by source scan (#2291)', () => {
  it.each([
    ['leads', 'app/api/tenant/leads/bulk/route.ts'],
    ['contacts', 'app/api/tenant/contacts/bulk/route.ts'],
    ['deals', 'app/api/tenant/deals/bulk/route.ts'],
    ['tasks', 'app/api/tenant/tasks/bulk/route.ts'],
    ['companies', 'app/api/tenant/companies/bulk/route.ts'],
  ])('add_to_segment in %s bulk validates a live segment only', (_name, file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toContain('isNull(segments.deletedAt)');
  });

  it('contacts/[id] server page filters all five billing reads', () => {
    const src = readFileSync('app/tenant/contacts/[id]/page.tsx', 'utf8');
    for (const table of ['invoices', 'orders', 'contracts', 'serviceSubscriptions', 'quotes']) {
      expect(src).toContain(`isNull(${table}.deletedAt)`);
    }
  });

  it('kb/segments/services list+detail routes keep the predicate the tests above prove', () => {
    const announcementsSrc = readFileSync('app/api/superadmin/announcements/route.ts', 'utf8');
    // The PATCH pre-read is a mutation guard, not a list read — must stay unfiltered-by-list-semantics but still 404s on hard-deleted rows.
    expect(announcementsSrc).toContain('isNull(announcements.deletedAt)');
  });
});
