/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3111 — bulk contact restore re-admits rows to the plan-counted pool without
 * re-incrementing `currentContacts`.
 *
 * Two defects, one commit, because the second is only reachable once the first
 * is fixed:
 *
 *  1. `validIds` (`:113-127`) is built with `deletedAt IS NULL`, and `:130-131`
 *     404s on an empty set before the switch — so `restore` on trashed ids is a
 *     no-op today. Both siblings carry `&& action !== 'restore'` on that guard and
 *     re-resolve the target set against the tombstone
 *     (`leads/bulk/route.ts:70`, `:300-317`; `deals/bulk/route.ts:92`, `:405-422`),
 *     and both comments say in those words that reusing `validIds` made restore
 *     dead. Contacts is the one route that never got it.
 *  2. The `delete` case decrements `tenants.currentContacts` by exactly the rows it
 *     tombstoned (`:288-292`). The `restore` case is a bare UPDATE — no increment,
 *     no plan check, not in a transaction. Restore 5,000 and the counter stays down:
 *     `superadmin/usage/route.ts:37` under-reports forever, and the `maxContacts`
 *     gate that reads it (`leads/import:310`, `lib/import/contacts.ts:146`) admits
 *     rows past the plan.
 *
 * The counter must move for **re-admitted** rows only. Contacts' `restore` also
 * serves archive-undo (`contacts-data-table.tsx` wires it to the Archive action's
 * Undo and to a "Restore … from archive" action), and `archive` never decremented
 * anything — a blanket `+ restored` would inflate the pool on every un-archive.
 *
 * The lock shape is #3080's (`leads/import/route.ts:273-314`): lock the tenant row
 * FOR UPDATE, read the counter from the locked row, then a SQL-side
 * `COALESCE(current_contacts, 0) + n`. `deals/bulk` reads the counter *outside* its
 * transaction — the ordering here is deliberately the one that makes the check
 * mean something.
 *
 * No database: every assertion renders the SQL this route actually asked Postgres
 * for (`PgDialect.sqlToQuery`) and reads the `set()` clause off the same recorder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const C2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const dialect = new PgDialect({} as never);

const { mockReadJsonBody, mockBody } = vi.hoisted(() => ({
  mockReadJsonBody: vi.fn(),
  mockBody: { current: {} as Record<string, unknown> },
}));

type Stmt = { kind: 'select' | 'update' | 'execute'; table: string; where: string; set: string; setParams: unknown[] };
let stmts: Stmt[] = [];
/** One entry per awaited select, in call order. */
let selectQueue: unknown[][] = [];
/** One entry per awaited update, so rowCount can be steered per statement. */
let updateQueue: number[] = [];

function render(value: unknown): string {
  if (value && typeof value === 'object' && typeof (value as { toQuery?: unknown }).toQuery === 'function') {
    return dialect.sqlToQuery(value as never).sql;
  }
  if (value instanceof Date) return 'DATE';
  if (value === null) return 'null';
  return String(value);
}

/** The `set()` clause as SQL text, plus the values Postgres will bind to it. */
function renderSet(obj: Record<string, unknown>): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const text = Object.entries(obj)
    .map(([k, v]) => {
      if (v && typeof v === 'object' && typeof (v as { toQuery?: unknown }).toQuery === 'function') {
        const q = dialect.sqlToQuery(v as never);
        params.push(...q.params);
        return `${k}=${q.sql}`;
      }
      return `${k}=${render(v)}`;
    })
    .join(',');
  return { text, params };
}

function sqlOf(fragment: unknown): string {
  // and()/or() hand back an SQL wrapper; a bare string never reaches here.
  return dialect.sqlToQuery(fragment as never).sql;
}

/**
 * A drizzle table's name is not a stable property across versions, so the table a
 * statement belongs to is read back out of the SQL it rendered — which is also the
 * only thing that is guaranteed to agree with what Postgres will see.
 */
function tableOf(sqlText: string, hint: string | undefined): string {
  // `.name` is not a stable property on a drizzle table across versions, so take
  // the hint only when it actually looks like a table name and otherwise read the
  // table back out of the rendered SQL — which is the only thing guaranteed to
  // agree with what Postgres sees.
  if (hint && /^[a-z_]+$/i.test(hint)) return hint;
  return sqlText.match(/"([a-z_]+)"\./i)?.[1] ?? '';
}

function builder(hint: string, kind: 'select' | 'update') {
  const b: Record<string, unknown> = {};
  let setObj: Record<string, unknown> = {};
  for (const m of ['leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'limit', 'offset', 'returning']) {
    b[m] = () => b;
  }
  b['from'] = (t: { name?: string }) => builder(String(t?.name ?? hint ?? ''), kind);
  b['set'] = (o: Record<string, unknown>) => {
    setObj = o;
    return b;
  };
  b['where'] = (predicate: unknown) => {
    const where = sqlOf(predicate);
    const rendered = renderSet(setObj);
    stmts.push({ kind, table: tableOf(where, hint), where, set: rendered.text, setParams: rendered.params });
    return b;
  };
  b['then'] = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
    if (kind === 'select') return Promise.resolve(selectQueue.shift() ?? []).then(ok, err);
    return Promise.resolve({ rowCount: updateQueue.shift() ?? 1 }).then(ok, err);
  };
  return b;
}

const client = {
  select: () => builder('', 'select'),
  update: (t: { name?: string }) => builder(String(t?.name ?? ''), 'update'),
  insert: () => {
    const b: Record<string, unknown> = {};
    for (const m of ['values', 'onConflictDoNothing', 'onConflictDoUpdate']) b[m] = () => b;
    b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve({ rowCount: 1 }).then(ok);
    return b;
  },
  execute: (fragment: unknown) => {
    stmts.push({ kind: 'execute', table: '', where: sqlOf(fragment), set: '', setParams: [] });
    return Promise.resolve({ rows: [] });
  },
  transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(client),
};

vi.mock('@/drizzle/db', () => ({ db: client }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: mockReadJsonBody,
  validateBody: vi.fn(() => ({ success: true, data: mockBody.current })),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/dashboard/widget-cache', () => ({ invalidateWidgetCache: vi.fn() }));

const { requireAuth } = await import('@/lib/auth/middleware');
const { logAudit } = await import('@/lib/audit');
const bulk = await import('@/app/api/tenant/contacts/bulk/route');

const AUTH = {
  userId: USER, tenantId: TENANT, roleSlug: 'owner',
  permissions: { 'contacts.view': true, 'contacts.view_all': true, 'contacts.edit': true, 'contacts.delete': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

function post(payload: Record<string, unknown>) {
  mockBody.current = { ids: payload.contact_ids ?? [] };
  mockReadJsonBody.mockResolvedValue(payload);
  return bulk.POST(new NextRequest(new URL('http://localhost:3000/api/tenant/contacts/bulk'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
  }));
}

const TRASHED = [{ id: C1, deletedAt: new Date('2026-10-01T00:00:00Z') }, { id: C2, deletedAt: new Date('2026-10-01T00:00:00Z') }];
const ARCHIVED_ONLY = [{ id: C1, deletedAt: null }, { id: C2, deletedAt: null }];

const of = (table: string, kind = 'update') => stmts.filter(s => s.kind === kind && s.table === table);

beforeEach(() => {
  stmts = [];
  selectQueue = [];
  updateQueue = [];
  vi.mocked(requireAuth).mockResolvedValue(AUTH);
  vi.mocked(logAudit).mockClear();
});

describe('POST /api/tenant/contacts/bulk action=restore re-admits the pool it took away (#3111)', () => {
  it('answers the restore at all — the live-id guard must not 404 it', async () => {
    selectQueue = [
      [],            // `valid` — the live set, which is empty by definition for trashed ids
      TRASHED,       // the tombstone re-resolution
      [{ currentContacts: 10, maxContacts: 1000 }],
    ];
    updateQueue = [2];
    const res = await post({ action: 'restore', contact_ids: [C1, C2] });
    expect(res.status, `route answered ${res.status}: ${JSON.stringify(stmts.map(s => s.where))}`).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(2);
  });

  it('re-resolves the target set against the tombstone, not against validIds', async () => {
    selectQueue = [[], TRASHED, [{ currentContacts: 10, maxContacts: 1000 }]];
    updateQueue = [2];
    await post({ action: 'restore', contact_ids: [C1, C2] });
    const contactUpdates = of('contacts');
    expect(contactUpdates.length).toBeGreaterThan(0);
    for (const s of contactUpdates) {
      expect(s.where, s.where).toMatch(/"contacts"\."deleted_at" is not null/i);
      expect(s.where, s.where).not.toMatch(/"contacts"\."deleted_at" is null$/i);
      expect(s.set).toMatch(/deletedAt=null/);
    }
  });

  it('locks the tenant row and reads the counter before anything is written', async () => {
    selectQueue = [[], TRASHED, [{ currentContacts: 10, maxContacts: 1000 }]];
    updateQueue = [2];
    await post({ action: 'restore', contact_ids: [C1, C2] });
    const lock = stmts.findIndex(s => s.kind === 'execute' && /for update/i.test(s.where));
    expect(lock, `no FOR UPDATE in ${JSON.stringify(stmts)}`).toBeGreaterThanOrEqual(0);
    const counterRead = stmts.findIndex(s => s.kind === 'select' && /"tenants"/.test(s.where));
    const contactsWrite = stmts.findIndex(s => s.kind === 'update' && s.table === 'contacts');
    expect(counterRead, 'counter read missing').toBeGreaterThanOrEqual(0);
    expect(contactsWrite, 'no contacts update issued').toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(counterRead);
    expect(counterRead).toBeLessThan(contactsWrite);
  });

  it('re-increments currentContacts by the rows it actually re-admitted, in SQL', async () => {
    selectQueue = [[], TRASHED, [{ currentContacts: 10, maxContacts: 1000 }]];
    updateQueue = [2, 1];
    await post({ action: 'restore', contact_ids: [C1, C2] });
    const tenantWrites = of('tenants');
    expect(tenantWrites.length, JSON.stringify(stmts)).toBe(1);
    expect(tenantWrites[0].set).toMatch(/currentContacts=COALESCE\("tenants"\."current_contacts", 0\) \+ \$/i);
    expect(tenantWrites[0].where).toMatch(/"tenants"\."id" = \$1/i);
  });

  it('increments by the rows the UPDATE actually took, not by the ids it asked for', async () => {
    // Three ids resolve as restorable, but a concurrent writer wins the race and
    // only two come back in the UPDATE's rowCount. A `+ ids.length` would leave the
    // counter one above the live rows — the same drift this issue is about, in the
    // other direction.
    selectQueue = [
      [],
      [...TRASHED, { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', deletedAt: new Date() }],
      [{ currentContacts: 10, maxContacts: 1000 }],
    ];
    updateQueue = [2, 1];
    const res = await post({ action: 'restore', contact_ids: [C1, C2, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'] });
    expect(res.status).toBe(200);
    expect((await res.json()).affected).toBe(2);
    const tenantWrites = of('tenants');
    expect(tenantWrites.length).toBe(1);
    expect(tenantWrites[0].setParams, `bound: ${JSON.stringify(tenantWrites[0].setParams)}`).toContain(2);
    expect(tenantWrites[0].setParams).not.toContain(3);
  });

  it('refuses a restore that would exceed the plan limit, and writes nothing', async () => {
    selectQueue = [[], TRASHED, [{ currentContacts: 999, maxContacts: 1000 }]];
    const res = await post({ action: 'restore', contact_ids: [C1, C2] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/plan limit/i);
    expect(of('contacts'), 'a refused restore still wrote contacts').toEqual([]);
    expect(of('tenants'), 'a refused restore still moved the counter').toEqual([]);
  });

  it('an archive-only restore re-opens the rows and leaves the counter alone', async () => {
    selectQueue = [[], ARCHIVED_ONLY];
    updateQueue = [2];
    const res = await post({ action: 'restore', contact_ids: [C1, C2] });
    expect(res.status).toBe(200);
    expect(of('tenants'), 'un-archiving a live contact is not a new pool member').toEqual([]);
    const contactUpdates = of('contacts');
    expect(contactUpdates.length).toBeGreaterThan(0);
    expect(contactUpdates[0].set).toMatch(/isArchived=false/);
  });

  it('a plan gate that is not configured never blocks a restore', async () => {
    selectQueue = [[], TRASHED, [{ currentContacts: 50_000, maxContacts: null }]];
    updateQueue = [2, 1];
    const res = await post({ action: 'restore', contact_ids: [C1, C2] });
    expect(res.status).toBe(200);
    expect(of('tenants').length).toBe(1);
  });

  it('keeps every statement of the restore scoped to this tenant', async () => {
    selectQueue = [[], TRASHED, [{ currentContacts: 10, maxContacts: 1000 }]];
    updateQueue = [2, 1];
    await post({ action: 'restore', contact_ids: [C1, C2] });
    const scoped = stmts.filter(s => s.table === 'contacts' || s.table === 'tenants');
    expect(scoped.length).toBeGreaterThan(0);
    for (const s of scoped) {
      if (s.kind === 'execute') continue; // the lock is keyed by tenant id in its own SQL
      // A contacts statement is scoped by the tenant column; a tenants statement IS
      // the tenant row, so its `tenants.id = $1` is the same narrowing.
      expect(
        /tenant_id" = \$\d+/.test(s.where) || /"tenants"\."id" = \$\d+/.test(s.where),
        `${s.kind} ${s.table}: ${s.where}`,
      ).toBe(true);
    }
    const lock = stmts.find(s => s.kind === 'execute');
    expect(lock?.where, 'the FOR UPDATE must be keyed to the caller tenant').toMatch(/FROM tenants WHERE id = \$1/i);
  });

  it('audits the ids it restored, not the empty live set the guard rejected', async () => {
    selectQueue = [[], TRASHED, [{ currentContacts: 10, maxContacts: 1000 }]];
    updateQueue = [2, 1];
    await post({ action: 'restore', contact_ids: [C1, C2] });
    expect(logAudit).toHaveBeenCalled();
    const arg = vi.mocked(logAudit).mock.calls.at(-1)?.[0] as { newData?: { contact_ids?: string[]; count?: number } };
    expect(arg.newData?.contact_ids).toEqual([C1, C2]);
  });
});
