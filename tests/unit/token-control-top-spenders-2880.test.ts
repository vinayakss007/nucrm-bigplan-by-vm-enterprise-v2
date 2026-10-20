import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { join } from 'node:path';

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2880 — the Token Control "Top Spenders" table has been GETting an endpoint that
 * was never written.
 *
 * `app/superadmin/token-control/page.tsx:74` asks for
 * `/api/superadmin/token-control/report/top-spenders`, and there was no
 * `…/token-control/report/` directory at all: `git log --diff-filter=D` on that path
 * is empty, so the handler was never written and then deleted — same shape as #2822
 * and #2597. The 404 landed in `spendersQuery.error`, which became `topTenants = []`,
 * which became "No spending data yet" served to every super admin on every install as
 * a fact about their tenants.
 *
 * Writing the handler is the smaller half. The larger one is that the report is
 * cross-tenant and `ai_usage_aggregated` carries only the looped
 * `tenant_isolation` of `0037_tenant_isolation_hardening.sql:245-252`, which gates on
 * `app.current_tenant` and nothing else: a handler written naively would have answered
 * `200 {"tenants": []}` from behind RLS — a brand-new way to tell the same lie. So
 * these tests hold three things at once:
 *
 *   1. the read runs inside the platform context (`set_config('app.is_super_admin',…)`)
 *      and the migration chain actually ships a SELECT policy that honours it, without
 *      un-gating the writes on the same table;
 *   2. the SQL the route renders — per-module `FILTER` sums, the current billing
 *      period, both `deleted_at IS NULL`s, module names and `limit` as bound parameters
 *      rather than text;
 *   3. the arithmetic the page's seven columns need, including that "% of Total" is a
 *      share of the platform, not of the rows the page happens to be shown.
 *
 * The fake client answers with rows in the shape `pg` returns them for drizzle's
 * `rowMode: 'array'` queries — arrays, not objects — so the mapping under test is
 * drizzle's real one, not a stand-in. The platform-context `set_config` is a statement
 * rather than a read, so it is kept out of the fixture queue for the same reason: if
 * it took a row, the ranked query would answer with the platform total and every
 * number below it would be off by one.
 *
 *   Measured against `main` (`a1a2fa81`) with only these two test files copied over:
 *   this file never collects — `Cannot find package
 *   '@/app/api/superadmin/token-control/report/top-spenders/route'` — and
 *   `api-url-has-handler-2822` convicts exactly that URL, 2 offenders against 1
 *   allowlisted entry. With the branch's `app/`, `drizzle/` and the shrunken allowlist
 *   applied on top, the same two files are 19/19.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

const h = vi.hoisted(() => ({
  /** every statement the route put on the wire, in order */
  queries: [] as Array<{ text: string; params: unknown[] }>,
  /** what the next statement answers, in call order */
  results: [] as unknown[][],
  /** the statement (0-based) that throws instead of answering */
  failIndex: null as number | null,
}));

vi.mock('@/drizzle/db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  // A real drizzle instance over a `pg` client that only records: the SQL the route
  // renders is drizzle's own, so nothing here is a paraphrase of the query under test.
  const client = {
    query: async (config: { text?: string }, params: unknown[]) => {
      const text = config.text ?? String(config);
      h.queries.push({ text, params });
      if (h.failIndex === h.queries.length - 1) {
        throw new Error('connection reset by peer');
      }
      // The platform-context `set_config` is a statement, not a read: if it were
      // allowed to take a fixture row, the ranked query would answer with the
      // platform total and every number further down would be off by one.
      const rows = text.includes('set_config(') ? [[]] : (h.results.shift() ?? []);
      return { rows, rowCount: rows.length, command: 'SELECT' };
    },
  };
  const tx = drizzle(client as never);
  return {
    db: {
      transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      // A read on the bare pool runs with no platform context, which is the empty-list
      // bug wearing a fix. Nothing is supposed to get here.
      select: () => {
        throw new Error('top-spenders must read inside withSecurityContext, not the bare pool');
      },
      execute: () => {
        throw new Error('top-spenders must read inside withSecurityContext, not the bare pool');
      },
    },
  };
});

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/superadmin/token-control/report/top-spenders/route');
const { orderedCorpus, buildPolicyMap } = await import('../../scripts/check-migration-rls-dml.mjs');
const { gatingPolicies } = await import('../../scripts/rls-policy-map.mjs');

function request(query = '') {
  return new NextRequest(`http://nucrm.test/api/superadmin/token-control/report/top-spenders${query}`);
}

async function get(query = '') {
  const res = await route.GET(request(query));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** ranked rows then the platform total, in the order the route asks for them */
function fixtures(rankRows: unknown[][], platformTotal: string, period = '2026-10') {
  h.results = [rankRows, [[period, platformTotal]]];
}

beforeEach(() => {
  h.queries = [];
  h.results = [];
  h.failIndex = null;
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: ADMIN, tenantId: null, isSuperAdmin: true, user: { email: 'a@b.test' },
  });
});

describe('the report reads where a super admin can actually see the rows (#2880)', () => {
  it('refuses a non-super-admin before touching the database', async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: ADMIN, tenantId: TENANT_A, isSuperAdmin: false,
    });
    const { status } = await get();
    expect(status).toBe(403);
    expect(h.queries, 'a refused read must not be a read').toEqual([]);
  });

  it('asks for the platform context on the same connection it reads on', async () => {
    fixtures([[TENANT_A, 'Acme', '100', '0', '0', '100']], '100');
    const { status } = await get();
    expect(status).toBe(200);
    const setGuc = h.queries.findIndex((q) => q.text.includes(`set_config('app.is_super_admin', 'true'`));
    expect(setGuc, 'the aggregate must not run before the waiver GUC').toBe(0);
    // both aggregates, and nothing else
    expect(h.queries.length).toBe(3);
    expect(h.queries[1].text).toContain('group by');
    expect(h.queries[2].text).not.toContain('group by');
  });

  it('ships a SELECT policy that honours that GUC, and leaves the writes gated', () => {
    const { ordered } = orderedCorpus(join(process.cwd(), 'drizzle', 'migrations'));
    const map = buildPolicyMap(ordered);
    const { covering } = gatingPolicies(map, 'ai_usage_aggregated', 'select');
    const waiver = covering.find(
      (p: { gucs?: Set<string>; restrictive?: boolean }) =>
        !p.restrictive && p.gucs?.has('app.is_super_admin'),
    );
    expect(waiver, 'no permissive SELECT policy for ai_usage_aggregated reads app.is_super_admin — the report reads an empty table').toBeTruthy();
    // the 0037 loop writes its policies through format('%I'), so they arrive as
    // ambient events; what 0131 must NOT do is take the FOR ALL policy away, since
    // RLS is default-deny and recordUsage() writes through it
    const writes = gatingPolicies(map, 'ai_usage_aggregated', 'insert');
    expect(writes.covering.length, 'ai_usage_aggregated lost the policy its writers need').toBeGreaterThan(0);
    expect(
      writes.covering.some((p: { name: string }) => p.name === 'ai_usage_aggregated_super_admin_read'),
      'the SELECT waiver must not be the policy that gates writes',
    ).toBe(false);
  });
});

describe('the SQL the table needs', () => {
  it('splits the month into the buckets the columns name, with the module names bound', async () => {
    fixtures([[TENANT_A, 'Acme', '400', '500', '600', '1500']], '1500');
    await get();
    const sqlText = h.queries[1].text;
    expect(sqlText).toContain('COALESCE(SUM("ai_usage_aggregated"."cost_cents") FILTER (WHERE "ai_usage_aggregated"."module_name" NOT IN ($1, $2)), 0)');
    expect(sqlText).toContain('= $3'); // whatsapp
    expect(sqlText).toContain('= $4'); // voice
    expect(h.queries[1].params.slice(0, 4)).toEqual(['whatsapp', 'voice', 'whatsapp', 'voice']);
    // and never interpolates them
    expect(sqlText).not.toContain("'whatsapp'");
  });

  it('bounds the window to the billing period the Budgets tab uses, and skips soft-deleted rows on both sides', async () => {
    fixtures([[TENANT_A, 'Acme', '1', '0', '0', '1']], '1');
    await get();
    const sqlText = h.queries[1].text;
    expect(sqlText).toContain(`"billing_period" = TO_CHAR(NOW(), 'YYYY-MM')`);
    expect(sqlText).toContain('"ai_usage_aggregated"."deleted_at" is null');
    expect(sqlText).toContain('"tenants"."deleted_at" is null');
    // the ranking is over spend, not over the rows the ledger happens to hold
    expect(sqlText).toContain('order by COALESCE(SUM("ai_usage_aggregated"."cost_cents"), 0) DESC');
  });

  it('clamps limit into the parameter list instead of trusting the query string', async () => {
    fixtures([], '0');
    await get('?limit=99999');
    expect(h.queries[1].params.at(-1)).toBe(100);
    h.queries = [];
    fixtures([], '0');
    await get('?limit=abc');
    expect(h.queries[1].params.at(-1)).toBe(10);
    h.queries = [];
    fixtures([], '0');
    await get('?limit=0');
    expect(h.queries[1].params.at(-1)).toBe(1);
    h.queries = [];
    fixtures([], '0');
    await get('?limit=3');
    expect(h.queries[1].params.at(-1)).toBe(3);
  });
});

describe('the numbers the seven columns render', () => {
  it('answers the shape the page destructures, as numbers', async () => {
    fixtures(
      [
        [TENANT_A, 'Acme', '40000', '50000', '60000', '150000'],
        [TENANT_B, 'Beta', '1000', '0', '0', '1000'],
      ],
      '200000',
    );
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json.period).toBe('2026-10');
    expect(json.platform_total_cents).toBe(200000);
    const rows = json.tenants as Array<Record<string, number | string>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      tenant_id: TENANT_A,
      tenant_name: 'Acme',
      openai_cents: 40000,
      whatsapp_cents: 50000,
      voice_cents: 60000,
      total_cents: 150000,
      pct_of_total: 75,
    });
    // pg hands numeric aggregates back as strings; the page calls `.toFixed` on
    // them, which is a TypeError on a string and a wrong number if it were `NaN`
    for (const key of ['openai_cents', 'whatsapp_cents', 'voice_cents', 'total_cents', 'pct_of_total']) {
      expect(typeof rows[0]![key], `page.tsx calls .toFixed on ${key}`).toBe('number');
    }
  });

  it('takes "% of Total" against the platform, not the rows on screen', async () => {
    // the two ranked tenants spend 900 of a 90000 platform month: 1% and 0.5%. Computed
    // over the returned rows they would read 66.7% and 33.3%, and the page would say a
    // quarter of the platform's money went to whoever opened the tab.
    fixtures(
      [
        [TENANT_A, 'Acme', '600', '0', '0', '600'],
        [TENANT_B, 'Beta', '300', '0', '0', '300'],
      ],
      '90000',
    );
    const { json } = await get();
    const rows = json.tenants as Array<{ pct_of_total: number }>;
    expect(rows[0]!.pct_of_total).toBe(0.7);
    expect(rows[1]!.pct_of_total).toBe(0.3);
  });

  it('reports 0% rather than NaN when nothing has been spent this month', async () => {
    fixtures([], '0');
    const { json } = await get();
    expect(json.tenants).toEqual([]);
    expect(json.platform_total_cents).toBe(0);
  });
});

describe('a read that failed is not a month with no spending', () => {
  it('answers 5xx when the ranked read fails, and does not dress it up as an empty list', async () => {
    h.failIndex = 1;
    const { status, json } = await get();
    expect(status).toBeGreaterThanOrEqual(500);
    expect(json.tenants, 'an unread report must not answer `tenants: []`').toBeUndefined();
  });

  it('answers 5xx when only the denominator fails', async () => {
    // the ranked rows are readable; without a platform total the percentages would be
    // invented, so the whole report is refused
    fixtures([[TENANT_A, 'Acme', '1', '0', '0', '1']], '0');
    h.failIndex = 2;
    const { status, json } = await get();
    expect(status).toBeGreaterThanOrEqual(500);
    expect(json.tenants).toBeUndefined();
  });
});
