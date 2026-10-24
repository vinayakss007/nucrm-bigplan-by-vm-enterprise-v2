/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3220 — a bulk operation's audit row must name the rows its own write touched.
 *
 * #3154 fixed the *write* for `restore`: the route's `validIds` is resolved through a
 * live-only query (`deletedAt IS NULL`), so it can never contain a trashed row, and the
 * case re-resolves `restorableIds` against the trash instead. The audit line was left
 * behind, still naming `validIds` — which for a restore is a set DISJOINT from the rows
 * the UPDATE wrote. So the hash-chained record of "who un-deleted what" listed up to
 * twenty live rows that this action never touched, and none of the trashed rows it did.
 *
 * `add_to_segment` over-claims the same way from the other direction:
 * `onConflictDoNothing` silently skips ids that were already members, `rowCount`
 * honestly reports how many were created, and the audited list was the whole request.
 *
 * And every route truncated the list with `.slice(0, 20)` without recording that it did,
 * so a 250-row entry reads as `count: 250` beside twenty ids with nothing saying the
 * list is a prefix. `MAX_BULK` makes that reachable by design.
 *
 * `contacts/bulk` already carried the first half of the fix by hand as its own
 * `auditIds`; that doctrine is now `bulkIdsAudit` in `lib/audit.ts`, and the screen at
 * the bottom of this file is what keeps the other five from drifting back — same
 * "promote the sweep into a CI assertion" move #3216 made.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRASHED = '33333333-3333-4333-8333-333333333333';
const LIVE = '44444444-4444-4444-8444-444444444444';
const LIVE2 = '55555555-5555-4555-8555-555555555555';
const SEGMENT = '66666666-6666-4666-8666-666666666666';
const dialect = new PgDialect({} as never);

type Clause = { sql: string; params: unknown[] };
let wheres: Clause[] = [];
let updates: { table: string; set: Record<string, unknown>; where: Clause }[] = [];
let inserts: { table: string; values: unknown }[] = [];
let audited: Record<string, unknown>[] = [];
let selectCall = 0;
let rowsPerCall: unknown[][] = [];
let rowCount = 1;
let returningRows: unknown[] = [];

const mockDb = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params as unknown[] });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

function setup(rows: unknown[][], opts: { affected?: number; returning?: unknown[] } = {}) {
  vi.resetModules();
  wheres = [];
  updates = [];
  inserts = [];
  audited = [];
  selectCall = 0;
  rowsPerCall = rows;
  rowCount = opts.affected ?? 1;
  returningRows = opts.returning ?? [];
  mockDb.select.mockImplementation(() => {
    const r = rowsPerCall[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(r);
  });
  const updateOn = () => (table: { [Symbol.for('drizzle:Name')]?: string }) => ({
    set: (vals: Record<string, unknown>) => ({
      where: (predicate: unknown) => {
        const rendered = dialect.sqlToQuery(predicate as never);
        updates.push({
          table: table[Symbol.for('drizzle:Name')] ?? '?',
          set: vals,
          where: { sql: rendered.sql, params: rendered.params as unknown[] },
        });
        return Promise.resolve({ rowCount });
      },
    }),
  });
  mockDb.update.mockImplementation(updateOn());
  mockDb.insert.mockImplementation((table: { [Symbol.for('drizzle:Name')]?: string }) => {
    const record = { table: table[Symbol.for('drizzle:Name')] ?? '?', values: undefined as unknown };
    inserts.push(record);
    const node: Record<string, unknown> = {
      values: (v: unknown) => {
        record.values = v;
        return node;
      },
      onConflictDoNothing: () => node,
      returning: () => Promise.resolve(returningRows),
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ rowCount: Array.isArray(record.values) ? record.values.length : 1 }),
    };
    return node;
  });
  // #3154's deals restore runs its UPDATE and the counter bump inside one transaction;
  // handing the callback the same handle keeps both visible to `updates`.
  mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({
    update: updateOn(),
    insert: mockDb.insert,
  }));
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/audit', async (importOriginal) => ({
  // The helper is the thing under test, so only the writer is faked.
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  logAudit: vi.fn(async (opts: { newData?: unknown }) => { audited.push((opts.newData ?? {}) as Record<string, unknown>); }),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: (_ctx: unknown, _entity: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
  enforceFieldRead: (_ctx: unknown, _entity: string, rows: unknown[]) => Promise.resolve(rows),
}));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/leads/convert', () => ({ convertLeadCore: vi.fn() }));
vi.mock('@/lib/dashboard/widget-cache', () => ({ invalidateWidgetCache: vi.fn() }));

const { requireAuth } = await import('@/lib/auth/middleware');

function broadCtx(module: string): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'admin',
    permissions: {
      [`${module}.view`]: true, [`${module}.edit`]: true, [`${module}.view_all`]: true,
      'automations.manage': true,
    },
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

const ROUTES = {
  tasks: () => import('@/app/api/tenant/tasks/bulk/route'),
  leads: () => import('@/app/api/tenant/leads/bulk/route'),
  deals: () => import('@/app/api/tenant/deals/bulk/route'),
  companies: () => import('@/app/api/tenant/companies/bulk/route'),
} as const;

type Route = keyof typeof ROUTES;
async function post(route: Route, body: unknown, ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const { POST } = await ROUTES[route]();
  return POST(new NextRequest(new URL(`/api/tenant/${route}/bulk`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  }));
}

/** The plan-limit read that leads and deals make after re-resolving the trash. */
const NO_PLAN_ROW: unknown[] = [];

describe.each([
  ['tasks', 'task_ids'],
  ['leads', 'lead_ids'],
  ['deals', 'deal_ids'],
  ['companies', 'company_ids'],
] as const)('#3220 — %s/bulk restore audits the set it restored', (route, idsKey) => {
  const planRows = route === 'leads' || route === 'deals' ? [NO_PLAN_ROW] : [];

  it('names the trashed ids, not the live ones the request also carried', async () => {
    // Query 1 is the live validation and genuinely contains LIVE; query 2 is the
    // trash re-resolve. So the two sets differ, and only one of them was written.
    setup([[{ id: LIVE }], [{ id: TRASHED }], ...planRows]);
    const res = await post(route, { action: 'restore', [idsKey]: [TRASHED, LIVE] }, broadCtx(route));
    expect(res.status, await res.text()).toBe(200);

    expect(audited).toHaveLength(1);
    const [entry] = audited;
    expect(entry![idsKey]).toEqual([TRASHED]);
    expect(entry![idsKey]).not.toContain(LIVE);
    expect(entry!.ids_total).toBe(1);
    expect(entry!.ids_listed).toBe(1);
    expect(entry!.count).toBe(1);
  });

  it('the audited ids are exactly the ids the UPDATE bound', async () => {
    setup([[{ id: LIVE }], [{ id: TRASHED }, { id: LIVE2 }], ...planRows], { affected: 2 });
    const res = await post(route, { action: 'restore', [idsKey]: [TRASHED, LIVE2, LIVE] }, broadCtx(route));
    expect(res.status, await res.text()).toBe(200);

    const write = updates.find(u => u.table === route) ?? updates[0];
    const bound = write!.where.params.filter(p => p !== TENANT && p !== MINE) as string[];
    expect(bound).toHaveLength(2);
    expect([...(audited[0]![idsKey] as string[])].sort()).toEqual(bound.sort());
    expect(audited[0]!.ids_total).toBe(2);
  });
});

describe('#3220 — add_to_segment audits the membership rows it created', () => {
  it('an id the ON CONFLICT DO NOTHING skipped is not claimed', async () => {
    // Both live ids are handed to the INSERT; the RETURNING reports only one of
    // them as a new row, because the other was already a member.
    setup([[{ id: LIVE }, { id: LIVE2 }], [{ id: SEGMENT }]], {
      returning: [{ entityId: LIVE }],
    });
    const res = await post('tasks', {
      action: 'add_to_segment', task_ids: [LIVE, LIVE2], payload: { segment_id: SEGMENT },
    }, broadCtx('tasks'));
    const body = await res.text();
    expect(res.status, body).toBe(200);

    expect(inserts).toHaveLength(1);
    const [entry] = audited;
    expect(entry!.task_ids).toEqual([LIVE]);
    expect(entry!.task_ids).not.toContain(LIVE2);
    expect(entry!.count).toBe(1);
    expect(entry!.ids_total).toBe(1);
    // The caller's own number agrees with the audit, not with the request.
    expect(JSON.parse(body)).toMatchObject({ affected: 1 });
  });
});

describe('#3220 — a truncated id list says so', () => {
  it('a 25-row action lists 20 and records that it did', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `44444444-0000-4000-8000-0000000000${String(i).padStart(2, '0')}` }));
    setup([many], { affected: 25 });
    const res = await post('tasks', { action: 'complete', task_ids: many.map(r => r.id) }, broadCtx('tasks'));
    expect(res.status, await res.text()).toBe(200);

    const [entry] = audited;
    expect(entry!.task_ids).toHaveLength(20);
    expect(entry!.ids_listed).toBe(20);
    expect(entry!.ids_total).toBe(25);
    expect(entry!.count).toBe(25);
  });
});

/** One `case 'x': { … }` block, up to the next case at the switch's own indent. */
function caseBlock(src: string, opener: string): string | null {
  const at = src.indexOf(opener);
  if (at === -1) return null;
  const rest = src.slice(at + opener.length);
  // Six spaces is the switch's own indent: a prose "case" inside a comment is
  // deeper and starts with `//`, so it cannot end the block.
  const next = /\n {6}(?:case |default:)/.exec(rest);
  return src.slice(at, next ? at + opener.length + next.index + 1 : src.length);
}

describe('bulkIdsAudit itself', () => {
  it('always states the pair, and echoes payload only when the caller has one', async () => {
    const { bulkIdsAudit, BULK_AUDIT_ID_LIMIT } = await import('@/lib/audit');
    expect(bulkIdsAudit({ idsKey: 'note_ids', ids: ['a'], affected: 1 })).toEqual({
      count: 1, note_ids: ['a'], ids_listed: 1, ids_total: 1,
    });
    const wide = bulkIdsAudit({
      idsKey: 'deal_ids', ids: Array.from({ length: BULK_AUDIT_ID_LIMIT + 1 }, (_, i) => `d${i}`),
      affected: BULK_AUDIT_ID_LIMIT + 1, payload: { status: 'won' },
    });
    expect(wide.deal_ids).toHaveLength(BULK_AUDIT_ID_LIMIT);
    expect(wide).toMatchObject({ ids_listed: BULK_AUDIT_ID_LIMIT, ids_total: 21, payload: { status: 'won' } });
  });
});

describe('#3220 screen — no bulk route may audit a set it did not write', () => {
  const BULK_FILES = [
    'tasks', 'leads', 'deals', 'companies', 'contacts', 'notes',
  ].map(m => `app/api/tenant/${m}/bulk/route.ts`);

  const sources = BULK_FILES.map(file => [file, readFileSync(file, 'utf8')] as const);

  it.each(sources)('%s builds its audit payload through bulkIdsAudit', (file, src) => {
    expect(src).toMatch(/logAudit\(\{[\s\S]*?newData: bulkIdsAudit\(/);
  });

  it.each(sources)('%s does not truncate an audited id list inline', (file, src) => {
    // The silent `slice(0, 20)` this issue is about: the helper owns that decision,
    // and a route that re-adds its own truncation loses `ids_listed` / `ids_total`.
    const auditBlock = src.slice(src.indexOf('logAudit('));
    expect(auditBlock.slice(0, auditBlock.indexOf('});'))).not.toMatch(/\.slice\(/);
  });

  it.each(sources.filter(([file]) => !file.includes('notes')))(
    '%s re-resolves its restore set into the audited ids',
    (file, src) => {
      const block = caseBlock(src, "case 'restore': {");
      expect(block, `${file} has no restore case`).not.toBeNull();
      expect(block).toMatch(/auditIds = (restorableIds|outcome\.ids)/);
    },
  );

  it.each(sources.filter(([file]) => !file.includes('notes')))(
    '%s reads its segment insert back with RETURNING',
    (file, src) => {
      const block = caseBlock(src, "case 'add_to_segment': {");
      expect(block, `${file} has no add_to_segment case`).not.toBeNull();
      expect(block).toMatch(/onConflictDoNothing\(\)[\s\n.]*\.returning\(/);
      expect(block).toMatch(/auditIds = inserted\.map/);
      expect(block).not.toMatch(/rowCount \?\? memberValues\.length/);
    },
  );

  it('the leads status branch audits only the conversions that reported ok', () => {
    // `convertedCount` counted every id the loop was handed; a conversion whose
    // result was not ok was counted anyway, and the audited set was the request.
    const block = caseBlock(
      readFileSync('app/api/tenant/leads/bulk/route.ts', 'utf8'),
      "case 'status': {",
    )!;
    expect(block).toMatch(/if \(result\.ok\) \{ convertedCount \+= 1; convertedIds\.push\(leadId\); \}/);
    expect(block).toMatch(/auditIds = convertedIds/);
  });

  it('the contacts sequence branch audits only the contacts it enrolled', () => {
    // `add_to_sequence` filters the opted-out rows before inserting; naming them in
    // the audit says a rep enrolled a contact who was never touched.
    const block = caseBlock(
      readFileSync('app/api/tenant/contacts/bulk/route.ts', 'utf8'),
      "case 'add_to_sequence': {",
    )!;
    expect(block).toMatch(/const eligibleIds = eligibleRows\.map\(r => r\.id\)/);
    expect(block).toMatch(/auditIds = eligibleIds/);
  });
});
