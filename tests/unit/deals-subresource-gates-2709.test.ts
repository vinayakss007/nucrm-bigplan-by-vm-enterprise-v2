/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2709 — the two routes that hold a deal's money checked nothing about the deal.
 *
 * `deals/[id]/route.ts` answers 403 without `deals.view`/`deals.edit`/`deals.delete`
 * (`:33`, `:99`, `:305`) and 404 for a row the caller neither owns nor created
 * (`:67-72`, `:160-165`, `:311-321`). `deals/[id]/products` and
 * `deals/[id]/forecast` do neither: no `requirePerm` in any of the six handlers, and
 * their shared `assertDeal(tenantId, dealId)` filters on `id + tenant_id +
 * deleted_at is null` only — so a `sales_rep` (whose `deals.view_all` is explicitly
 * false, `lib/permissions/definitions.ts:135`) reads and rewrites a colleague's
 * priced line items and forecast, and the `viewer` preset
 * (`definitions.ts:145` — `*.view` only) can add, change and delete them on a deal
 * it is allowed to look at and nothing more.
 *
 * The ids are reachable: `GET /api/tenant/activities` returns every row of the
 * tenant's timeline with its `entityId` (#2710), and `GET /deals/:id/products`,
 * itself unscoped, then prints the line-item ids PATCH and DELETE need. Products'
 * PATCH and DELETE are worse than unscoped — they never look at the deal at all,
 * so the deal id in their predicate is the only thing tying the write to a parent.
 *
 * `can()`/`requirePerm()` are left real because those checks *are* the behaviour
 * under test; a mocked middleware would grade the mock. The mocked reader answers
 * the way Postgres would: a deal the caller does not own resolves whenever the
 * emitted SQL does not narrow to them, which is what makes the unscoped route fail
 * these tests instead of passing them vacuously.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ITEM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FC = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const dialect = new PgDialect({} as never);

let reads: { sql: string; params: unknown[] }[] = [];
let writes: { kind: string; table: string; sql: string; params: unknown[] }[] = [];
let dealOwners: { assignedTo: string; createdBy: string } = { assignedTo: OTHER, createdBy: OTHER };
let perms: Record<string, boolean> = {};
let hasForecast = false;

const itemRow = {
  id: ITEM, dealId: DEAL, tenantId: TENANT, productName: 'Widget',
  description: null, quantity: 2, price: '10.00', deletedAt: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
};
const forecastRow = {
  id: FC, dealId: DEAL, tenantId: TENANT, predictedCloseDate: '2026-12-31',
  winProbability: '60', predictedValue: '4000', confidenceLevel: 'medium',
  deletedAt: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
};

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params };
}

/** The owner narrowing `ownerScope(ctx, 'deals.view_all', deals)` renders. */
const OWNER_CLAUSE = /\("deals"\."assigned_to" = .* OR "deals"\."created_by" = .*\)/i;

/**
 * Would Postgres hand back this deal? A query that never narrows to the caller
 * gets the row even when the caller cannot own it — the bug. A narrowed one is
 * answered by the row's real ownership.
 */
function dealVisible(q: { sql: string; params: unknown[] } | undefined): boolean {
  if (!q) return false;
  if (perms['deals.view_all'] === true) return true;
  const narrowed = OWNER_CLAUSE.test(q.sql) && q.params.filter(p => p === MINE).length >= 2;
  if (!narrowed) return true;
  return dealOwners.assignedTo === MINE || dealOwners.createdBy === MINE;
}

function answer(q: { sql: string; params: unknown[] } | undefined): unknown[] {
  if (!q) return [];
  if (/"deals"\."id"/i.test(q.sql)) return dealVisible(q) ? [{ id: DEAL, tenantId: TENANT, ...dealOwners }] : [];
  if (/"deal_products"\./i.test(q.sql)) return [itemRow];
  if (/"deal_forecasts"\./i.test(q.sql)) return hasForecast ? [forecastRow] : [];
  return [];
}

function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'offset']) builder[m] = chain;
  let last: { sql: string; params: unknown[] } | undefined;
  builder['where'] = (predicate: unknown) => {
    last = render(predicate);
    reads.push(last);
    return builder;
  };
  builder['limit'] = () => Promise.resolve(answer(last));
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(answer(last));
  return builder;
}

/** `db.update(t).set(...).where(...)` and `db.insert(t).values(...)`. */
function makeWriter(kind: 'update' | 'insert', table: string) {
  const row = table === 'deal_forecasts' ? forecastRow : itemRow;
  const writer: Record<string, unknown> = {};
  writer['set'] = () => writer;
  writer['values'] = (values: unknown) => {
    writes.push({ kind, table, sql: `insert into "${table}"`, params: [JSON.stringify(values)] });
    return writer;
  };
  writer['onConflictDoNothing'] = () => Promise.resolve([]);
  writer['where'] = (predicate: unknown) => {
    const q = render(predicate);
    writes.push({ kind, table, sql: q.sql, params: q.params });
    return Object.assign(Promise.resolve([row]), { returning: () => Promise.resolve([row]) });
  };
  writer['returning'] = () => Promise.resolve([row]);
  return writer;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/with-api-route', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/with-api-route')>('@/lib/api/with-api-route');
  return { ...actual, withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const products = await import('@/app/api/tenant/deals/[id]/products/route');
const forecast = await import('@/app/api/tenant/deals/[id]/forecast/route');

const MODS: Record<string, unknown> = { products, forecast };

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: deals.view/create/edit on, deals.view_all off (definitions.ts:135).
const REP = { 'deals.view': true, 'deals.create': true, 'deals.edit': true };
const MANAGER = { ...REP, 'deals.view_all': true };
// viewer preset: every `*.view`, no `*.edit`, no `*.delete` (definitions.ts:145).
const VIEWER = { 'deals.view': true, 'deals.view_all': false };

const PRODUCT_BODY = { product_name: 'Widget', quantity: 2, price: 10 };
const PRODUCT_PATCH = { item_id: ITEM, price: 99 };
const FORECAST_BODY = { probability: 70, forecast_amount: 5000 };

/** Every (route, verb) pair the issue names, with the body each one needs. */
const HANDLERS: [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', unknown][] = [
  ['products', 'GET', undefined],
  ['products', 'POST', PRODUCT_BODY],
  ['products', 'PATCH', PRODUCT_PATCH],
  ['products', 'DELETE', undefined],
  ['forecast', 'GET', undefined],
  ['forecast', 'POST', FORECAST_BODY],
];

function setup(permissions: Record<string, boolean>, as: { assignedTo?: string; createdBy?: string } = {}) {
  perms = permissions;
  dealOwners = { assignedTo: as.assignedTo ?? OTHER, createdBy: as.createdBy ?? OTHER };
  reads = [];
  writes = [];
  hasForecast = false;
  mockDb.select.mockImplementation(() => makeSelectBuilder());
  mockDb.update = vi.fn((table: unknown) => makeWriter('update', getTableName(table as never)));
  mockDb.delete = vi.fn((table: unknown) => makeWriter('delete', getTableName(table as never)));
  mockDb.insert = vi.fn((table: unknown) => makeWriter('insert', getTableName(table as never)));
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(permissions));
}

function call(which: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  const sub = which === 'products' ? 'products' : 'forecast';
  const search = method === 'DELETE' ? `?item_id=${ITEM}` : '';
  const req = new NextRequest(
    new URL(`/api/tenant/deals/${DEAL}/${sub}${search}`, 'http://localhost:3000'),
    {
      method,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const handler = (MODS[which] as Record<string, unknown>)[method] as (
    r: NextRequest, c: { params: Promise<{ id: string }> }
  ) => Promise<Response>;
  return handler(req, { params: Promise.resolve({ id: DEAL }) });
}

const dealReads = () => reads.filter(r => /"deals"\."id"/i.test(r.sql));
const itemReads = () => reads.filter(r => /"deal_products"\./i.test(r.sql));
const forecastReads = () => reads.filter(r => /"deal_forecasts"\./i.test(r.sql));
const bodyOf = async (res: Response) => JSON.stringify(await res.json());

beforeEach(() => {
  setup(REP);
});

describe('a rep cannot read or rewrite another rep\'s deal financials (#2709)', () => {
  it.each(HANDLERS)('%s %s answers 404 for a deal they neither own nor created', async (which, method, body) => {
    setup(REP);
      const res = await call(which, method, body);
    expect(res.status, `${which} ${method}: ${await bodyOf(res)}`).toBe(404);
  });

  it.each(HANDLERS)('%s %s reaches no write on the foreign deal', async (which, method, body) => {
    setup(REP);
      await call(which, method, body);
    if (method === 'GET') expect(writes).toHaveLength(0);
    else expect(writes.map(w => `${w.kind} ${w.table}`), which).toEqual([]);
  });

  it('the foreign read does not even look up the line items', async () => {
    setup(REP);
      await call('products', 'GET');
    expect(itemReads(), JSON.stringify(reads)).toHaveLength(0);
    await call('forecast', 'GET');
    expect(forecastReads(), JSON.stringify(reads)).toHaveLength(0);
  });

  it('products PATCH and DELETE look at the deal before writing, as GET and POST do', async () => {
    setup(REP, { assignedTo: MINE });
      await call('products', 'PATCH', PRODUCT_PATCH);
    expect(dealReads().length, 'PATCH issued no deal read').toBeGreaterThan(0);
    await call('products', 'DELETE');
    expect(dealReads().length, 'DELETE issued no deal read').toBeGreaterThan(1);
  });
});

describe('the financials are not writable without deals.edit (#2709)', () => {
  const WRITERS = HANDLERS.filter(([, m]) => m !== 'GET');

  it.each(WRITERS)('%s %s is 403 for a viewer writing their own deal', async (which, method, body) => {
    setup(VIEWER, { assignedTo: MINE });
      const res = await call(which, method, body);
    expect(res.status, `${which} ${method}: ${await bodyOf(res)}`).toBe(403);
  });

  it.each(WRITERS)('%s %s issues no write for that viewer', async (which, method, body) => {
    setup(VIEWER, { assignedTo: MINE });
      await call(which, method, body);
    expect(writes.map(w => `${w.kind} ${w.table}`), which).toEqual([]);
  });

  it('the same viewer still reads, because it holds deals.view', async () => {
    setup(VIEWER, { assignedTo: MINE });
      expect((await call('products', 'GET')).status).toBe(200);
    expect((await call('forecast', 'GET')).status).toBe(200);
  });
});

describe('the rules leave alone the callers who hold them (#2709)', () => {
  it.each(HANDLERS)('%s %s still works for the owner', async (which, method, body) => {
    setup(REP, { assignedTo: MINE });
      const res = await call(which, method, body);
    expect(res.status, `${which} ${method}: ${await bodyOf(res)}`).toBeLessThan(400);
  });

  it('a created-by match counts as ownership too', async () => {
    setup(REP, { createdBy: MINE });
      expect((await call('products', 'GET')).status).toBe(200);
  });

  it('forecast POST writes an update when the deal already has one', async () => {
    setup(REP, { assignedTo: MINE });
      hasForecast = true;
    const res = await call('forecast', 'POST', FORECAST_BODY);
    expect(res.status, await bodyOf(res)).toBe(200);
    expect(writes.map(w => `${w.kind} ${w.table}`)).toContain('update deal_forecasts');
  });

  it.each(HANDLERS)('%s %s still works for a deals.view_all holder', async (which, method, body) => {
    setup(MANAGER);
      const res = await call(which, method, body);
    expect(res.status, `${which} ${method}: ${await bodyOf(res)}`).toBeLessThan(400);
  });
});

describe('the narrowing is in the SQL, not only in the status code (#2709)', () => {
  it('a rep\'s deal read carries the owner predicate and their id twice', async () => {
    setup(REP);
      await call('forecast', 'GET');
    const [read] = dealReads();
    expect(read, JSON.stringify(reads)).toBeTruthy();
    expect(read.sql).toMatch(OWNER_CLAUSE);
    expect(read.params.filter(p => p === MINE)).toHaveLength(2);
  });

  it('a deals.view_all holder\'s read is byte-for-byte the tenant-wide one', async () => {
    setup(MANAGER);
      await call('forecast', 'GET');
    await call('products', 'GET');
    for (const read of dealReads()) {
      expect(read.sql).not.toMatch(OWNER_CLAUSE);
      expect(read.params).not.toContain(MINE);
    }
  });

  it('the tenant and tombstone predicates survive in every deal read', async () => {
    setup(REP, { assignedTo: MINE });
      await call('products', 'GET');
    const [read] = dealReads();
    expect(read.sql).toMatch(/"deals"\."tenant_id"/i);
    expect(read.params).toContain(TENANT);
    expect(read.sql).toMatch(/deleted_at/i);
  });

  it('the forecast upsert states the tenant it read from, not just the row id', async () => {
    setup(REP, { assignedTo: MINE });
      hasForecast = true;
    await call('forecast', 'POST', FORECAST_BODY);
    const [write] = writes;
    expect(write.table).toBe('deal_forecasts');
    expect(write.sql, write.sql).toMatch(/"deal_forecasts"\."tenant_id"/i);
    expect(write.params).toContain(TENANT);
  });

  it('the line-item writes keep tying the item to its deal and tenant', async () => {
    setup(REP, { assignedTo: MINE });
      await call('products', 'PATCH', PRODUCT_PATCH);
    await call('products', 'DELETE');
    for (const write of writes) {
      expect(write.sql, write.sql).toMatch(/"deal_products"\."deal_id"/i);
      expect(write.sql, write.sql).toMatch(/"deal_products"\."tenant_id"/i);
      expect(write.params).toContain(TENANT);
    }
  });
});
