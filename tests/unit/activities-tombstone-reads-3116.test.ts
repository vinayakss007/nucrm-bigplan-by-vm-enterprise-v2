/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3116 — a deleted contact note comes back on refresh.
 *
 * `DELETE /api/tenant/contacts/[id]/notes` soft-deletes: `notes/route.ts:174-181`
 * sets `activities.deletedAt` and guards its own WHERE on `isNull(deletedAt)`.
 * The GET twelve lines above it in the same file never reads the column, so the
 * panel the user just cleared refills itself on the next render. The two sibling
 * timeline readers do the same, each with its count query, so the deleted row
 * also inflates `total` (`hasMore` in the general feed).
 *
 * `isNull(activities.deletedAt)` already lives in three readers —
 * `dashboard/stats/route.ts:113`, `dashboard/widgets/activity/route.ts:31`,
 * `lib/activity/timeline.ts:110` — so the fix copies an established predicate
 * rather than deciding what the tombstone means.
 *
 * The assertion is deliberately "every statement this route issues against
 * `activities` carries the tombstone", not "the first one does": a list and its
 * count are two queries, and #2291 item 5 is what happens when only the visible
 * one gets fixed. The contacts-visibility probe those routes also run is a
 * `contacts` read, filtered by #2291-era work, and is excluded by table so this
 * stays one predicate about one table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOTE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEAL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const dialect = new PgDialect({} as never);

const { mockReadJsonBody } = vi.hoisted(() => ({ mockReadJsonBody: vi.fn() }));

let wheres: string[] = [];
let selectRows: unknown[] = [];

function chain(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'limit', 'offset']) {
    b[m] = () => b;
  }
  b['where'] = (predicate: unknown) => {
    wheres.push(dialect.sqlToQuery(predicate as never).sql);
    return b;
  };
  b['then'] = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, err);
  return b;
}

vi.mock('@/drizzle/db', () => ({
  db: { select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn() },
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
  tenantMeta: () => ({}),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/notifications', () => ({ processMentions: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: mockReadJsonBody,
  validateBody: vi.fn(() => ({ success: true, data: {} })),
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const { db } = await import('@/drizzle/db');
const notes = await import('@/app/api/tenant/contacts/[id]/notes/route');
const timeline = await import('@/app/api/tenant/contacts/[id]/timeline/route');
const feed = await import('@/app/api/tenant/activities/route');

const AUTH = {
  userId: USER, tenantId: TENANT, roleSlug: 'manager',
  permissions: { 'contacts.view': true, 'contacts.view_all': true, 'contacts.edit': true, 'deals.view_all': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

function req(url: string, method = 'GET') {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

const params = { params: Promise.resolve({ id: CONTACT }) };

const activitiesStatements = () => wheres.filter((sql) => /"activities"\./.test(sql));

/** Every activities read must carry the predicate; a route with no activities read is a test bug. */
function assertAllTombstoned(label: string) {
  const stmts = activitiesStatements();
  expect(stmts.length, `no activities statement rendered for ${label}: ${wheres.join('\n')}`).toBeGreaterThan(0);
  for (const sql of stmts) expect(sql, `${label}: ${sql}`).toMatch(/"activities"\."deleted_at" is null/i);
}

beforeEach(() => {
  wheres = [];
  selectRows = [{ id: CONTACT }];
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(AUTH);
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => chain(selectRows));
});

describe('GET /api/tenant/contacts/[id]/notes — the delete and the read are in one file (#3116)', () => {
  it('excludes tombstoned notes from the list', async () => {
    selectRows = [{ id: CONTACT }, { id: 'note-1' }];
    const res = await (notes.GET as (r: NextRequest, c: typeof params) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/notes`), params,
    );
    expect(res.status, await res.text()).toBe(200);
    assertAllTombstoned('notes GET');
  });

  it('keeps the predicates it already had — contact, tenant, and the newest-50 window', async () => {
    selectRows = [{ id: CONTACT }, { id: 'note-1' }];
    const res = await (notes.GET as (r: NextRequest, c: typeof params) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/notes`), params,
    );
    expect(res.status).toBe(200);
    const list = activitiesStatements().find((s) => /"activities"\."contact_id"/.test(s))!;
    expect(list).toMatch(/"activities"\."tenant_id"/);
    expect(list).toMatch(/"activities"\."contact_id"/);
  });

  it('the DELETE in the same file still guards on the tombstone it writes', async () => {
    selectRows = [{ id: CONTACT }];
    mockReadJsonBody.mockResolvedValue({ noteId: NOTE });
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const b: Record<string, unknown> = {};
      b['set'] = () => b;
      b['where'] = (p: unknown) => {
        wheres.push(dialect.sqlToQuery(p as never).sql);
        return Promise.resolve({ rowCount: 1 });
      };
      return b;
    });
    const res = await (notes.DELETE as (r: NextRequest, c: typeof params) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/notes`, 'DELETE'), params,
    );
    expect(res.status, await res.text()).toBe(200);
    assertAllTombstoned('notes DELETE');
  });
});

describe('GET /api/tenant/contacts/[id]/timeline — list and count share one predicate (#3116)', () => {
  it('both activities statements carry the tombstone', async () => {
    selectRows = [{ id: CONTACT }, { id: 'a-1' }, { total: 1 }];
    const res = await (timeline.GET as (r: NextRequest, c: typeof params) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/timeline`), params,
    );
    expect(res.status, await res.text()).toBe(200);
    expect(activitiesStatements().length).toBeGreaterThanOrEqual(2);
    assertAllTombstoned('timeline GET');
  });

  it('does not lose the contact + tenant scoping the predicate replaced', async () => {
    selectRows = [{ id: CONTACT }, { id: 'a-1' }, { total: 1 }];
    const res = await (timeline.GET as (r: NextRequest, c: typeof params) => Promise<Response>)(
      req(`/api/tenant/contacts/${CONTACT}/timeline`), params,
    );
    expect(res.status).toBe(200);
    for (const sql of activitiesStatements()) {
      expect(sql).toMatch(/"activities"\."contact_id"/);
      expect(sql).toMatch(/"activities"\."tenant_id"/);
    }
  });
});

describe('GET /api/tenant/activities — the feed page and its total cannot drift (#3116)', () => {
  it('count and page both exclude tombstoned rows', async () => {
    selectRows = [{ count: 3 }, { id: 'a-1' }];
    const res = await (feed.GET as (r: NextRequest) => Promise<Response>)(
      req(`/api/tenant/activities?deal_id=${DEAL}`),
    );
    expect(res.status, await res.text()).toBe(200);
    expect(activitiesStatements().length).toBeGreaterThanOrEqual(2);
    assertAllTombstoned('activities GET');
  });

  it('keeps the record selector that the feed is scoped by', async () => {
    selectRows = [{ count: 3 }, { id: 'a-1' }];
    const res = await (feed.GET as (r: NextRequest) => Promise<Response>)(
      req(`/api/tenant/activities?deal_id=${DEAL}`),
    );
    expect(res.status).toBe(200);
    for (const sql of activitiesStatements()) {
      expect(sql).toMatch(/"activities"\."entity_type"/);
      expect(sql).toMatch(/"activities"\."entity_id"/);
    }
  });

  it('answers 404 for a record the caller cannot see, without touching activities', async () => {
    selectRows = [];
    const res = await (feed.GET as (r: NextRequest) => Promise<Response>)(
      req(`/api/tenant/activities?deal_id=${DEAL}`),
    );
    expect(res.status).toBe(404);
    expect(activitiesStatements()).toHaveLength(0);
  });
});
