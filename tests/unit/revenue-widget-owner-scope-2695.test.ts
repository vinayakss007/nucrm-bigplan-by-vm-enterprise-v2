/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2695 — "Revenue MTD" was the deals read #2688 missed.
 *
 * Seven widgets got `ownerScope` + a per-caller cache key in #2688. This one,
 * live at `components/tenant/dashboard/widget-registry.ts:23-24`, is a `SUM`
 * over `deals` (`widgets/stats/revenue/route.ts:41-69`) filtered on tenant,
 * tombstone, the tenant's "won" stage and `date_trunc('month', now())` — and
 * it called `withCache(tid, 'stats-revenue', 300, …)` with the default
 * `scopeKey` of `'tenant'` (`lib/dashboard/widget-cache.ts:27`).
 *
 * So a rep whose pipeline tile beside it (`widgets/stats/pipeline/route.ts:49`,
 * which does carry `ownerScope(auth, 'deals.view_all', deals)`) showed only
 * their own won revenue saw the workspace's number, and that number was served
 * to every other caller in the tenant for the rest of the TTL window. The two
 * defects are the same pair #2688 refused to split, and both are asserted here:
 * on the SQL drizzle renders, and on the cache key the route hands `withCache`.
 *
 * The stage lookup (`:39`, since #3120 through
 * `lib/deals/won-stage-ids.ts:56-64`) reads `deal_stages`/`pipelines` — tenant
 * configuration, not owned records — so it stays tenant-wide, as it does in
 * every other widget. That is pinned so the next reader does not scope it too.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let cacheArgs: { widgetKey: string; scopeKey: string | undefined }[] = [];
const mockDb = { select: vi.fn() };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'having', 'limit']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  // #3120: the stage read now projects the NAME, because deciding which of
  // this tenant's stages is the win is `isWonStageName`'s job, not SQL's.
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve([{ id: STAGE, name: 'Won', total: 42000 }]);
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  // `can()` is the rule under test, so only `requireAuth` is faked.
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/dashboard/widget-cache', () => ({
  withCache: (_t: string, widgetKey: string, _ttl: number, fetcher: () => Promise<Response>, scopeKey?: string) => {
    cacheArgs.push({ widgetKey, scopeKey });
    return fetcher();
  },
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const revenue = await import('@/app/api/tenant/dashboard/widgets/stats/revenue/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function get(ctx: AuthContext) {
  wheres = [];
  cacheArgs = [];
  mockDb.select.mockImplementation(() => makeBuilder());
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  return (revenue.GET as (req: NextRequest) => Promise<Response>)(
    new NextRequest(new URL('/api/tenant/dashboard/widgets/stats/revenue', 'http://localhost:3000'), {
      method: 'GET',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
  );
}

const ownsDeals = (c: { sql: string; params: unknown[] }) =>
  /"deals"\."assigned_to".*=.*or.*"deals"\."created_by".*=/.test(c.sql)
  && c.params.filter(p => p === MINE).length === 2;

const dealsClause = () => wheres.find(w => /"deals"\."tenant_id"/.test(w.sql));

const REP = { 'deals.view': true, 'contacts.view': true };
const MANAGER = { ...REP, 'deals.view_all': true };

describe('Revenue MTD totals only the deals the caller may read (#2695)', () => {
  it('a rep without deals.view_all gets the owner predicate on the SUM', async () => {
    const res = await get(ctxWith(REP));
    expect(res.status, await res.text()).toBe(200);
    const clause = dealsClause();
    expect(clause, wheres.map(w => w.sql).join('\n')).toBeTruthy();
    expect(ownsDeals(clause!), clause!.sql).toBe(true);
  });

  it('keeps the won-stage and month terms it already had', async () => {
    await get(ctxWith(REP));
    const clause = dealsClause()!;
    expect(clause.sql).toMatch(/"deals"\."stage_id"/);
    expect(clause.sql).toMatch(/date_trunc\('month', now\(\)\)/);
    expect(clause.sql).toMatch(/"deals"\."deleted_at" is null/i);
  });

  it('excludes archived deals, which widgets/stats/pipeline:43 already does', async () => {
    await get(ctxWith(REP));
    const clause = dealsClause()!;
    expect(clause.sql).toMatch(/'archived'/);
  });

  it('hands withCache a per-caller scope key, not the tenant default', async () => {
    await get(ctxWith(REP));
    expect(cacheArgs.map(c => c.widgetKey)).toContain('stats-revenue');
    expect(cacheArgs[0].scopeKey, JSON.stringify(cacheArgs)).toBe(MINE);
  });
});

describe('a deals.view_all holder keeps the tenant-wide tile (#2695)', () => {
  it('renders no owner predicate', async () => {
    const res = await get(ctxWith(MANAGER));
    expect(res.status, await res.text()).toBe(200);
    const clause = dealsClause()!;
    expect(clause.sql).not.toMatch(/"deals"."created_by"/);
    expect(clause.params.filter(p => p === MINE)).toHaveLength(0);
  });

  it('shares one tenant-scoped cache entry with every other manager', async () => {
    await get(ctxWith(MANAGER));
    expect(cacheArgs[0].scopeKey, JSON.stringify(cacheArgs)).toBe('tenant');
  });

  it('the stage lookup stays tenant-wide — deal_stages is config, not a record with an owner', async () => {
    await get(ctxWith(REP));
    const stageClause = wheres.find(w => /"deal_stages"|"pipelines"/.test(w.sql));
    expect(stageClause, wheres.map(w => w.sql).join('\n')).toBeTruthy();
    expect(stageClause!.sql).not.toMatch(/created_by|assigned_to/);
  });
});
