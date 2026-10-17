/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2758 / #2759 — `app/api/tenant/analytics/usage/route.ts` answered the three
 * `lastMonth` counts over **every** row in the window, while their `thisMonth` and
 * `totals` siblings filtered `deleted_at IS NULL`. The cards read those fields at
 * `app/tenant/settings/usage/page.tsx:56-59` and `:93` renders
 * `<Trend current={card.thisMonth} previous={card.lastMonth} />`, so the two numbers
 * being divided were measurements of two different populations: a contact created Sep 20
 * and soft-deleted Oct 3 was in the baseline and in nothing else, which makes the
 * arrow report a loss the tenant already took — and reports it with a magnitude that
 * grows with however many tombstones the tenant has accumulated.
 *
 * The asymmetry was an omission, not a rule: in the same statement all six
 * `thisMonth` counts, all three `totals` counts and both `dealValue` sums filter the
 * tombstone. The three `lastMonth` ones were the only reads in the file that did not.
 *
 * Two kinds of assertion, because the bug was structural:
 *   - a **predicate-parity** check — strip the window terms out of a `lastMonth`
 *     fragment and it must be character-identical to the same table's `thisMonth`
 *     fragment. That is stronger than asserting the term exists: it fails for any
 *     other predicate one side gained or lost, including a future edit;
 *   - the **count** a same-population baseline produces, answered by the mock the way
 *     Postgres would answer the rendered fragment.
 *
 * It also pins the opposite direction, which is where a consistency sweep would
 * break this route: `support_tickets` and `email_log` have **no `deleted_at` column**
 * (`drizzle/schema/support.ts:95-137`, `drizzle/schema/comm.ts:218`), so their
 * fragments must NOT grow the term — `${supportTickets.deletedAt}` is `undefined`
 * there, and measured through this repo's own dependency
 * (`new PgDialect({} as never).sqlToQuery(…)` with an `undefined` chunk) drizzle
 * renders it as **nothing**, leaving `… AND  IS NULL` with no left operand: a Postgres
 * syntax error, so the endpoint 500s rather than answering a wrong number.
 *
 * Measured red against `main` (`4f82ec27`), the route restored from HEAD: **10 failed /
 * 3 passed here**, and **14 failed / 8 passed** across this file plus
 * `usage-last-month-window-2756.test.ts`, whose four tombstone-pinned expectations are
 * the other half of the measurement (they were written to go red on purpose when #2758
 * closed — this is that commit). The three that pass on `main` are exactly the
 * `support_tickets`/`email_log` guards below, which must keep passing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const dialect = new PgDialect({} as never);

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Local-time constructors, so the fixtures mean the same calendar day the route does. */
const at = (y: number, monthIndex: number, day: number, h = 0, mi = 0, s = 0) =>
  new Date(y, monthIndex, day, h, mi, s);

interface Row {
  id: string;
  tenant_id: string;
  created_at: Date;
  deleted_at: Date | null;
  amount?: number;
}

const row = (id: string, created_at: Date, extra: Partial<Row> = {}): Row =>
  ({ id, tenant_id: TENANT, created_at, deleted_at: null, ...extra });

/**
 * October 17 pinned, so the baseline is September. Three live September contacts,
 * one September contact deleted in October (the row this issue is about), one
 * cross-tenant tombstone, and one October row.
 */
function fixtures(): Record<string, Row[]> {
  return {
    contacts: [
      row('c-sep-05', at(2026, 8, 5, 9, 0, 0)),
      row('c-sep-12', at(2026, 8, 12, 9, 0, 0)),
      row('c-sep-30', at(2026, 8, 30, 18, 0, 0)),
      row('c-sep-20-dead', at(2026, 8, 20, 12, 0, 0), { deleted_at: at(2026, 9, 3, 12, 0, 0) }),
      row('c-oct-05', at(2026, 9, 5, 9, 0, 0)),
      row('c-other-sep', at(2026, 8, 15, 9, 0, 0), { tenant_id: OTHER_TENANT }),
    ],
    deals: [
      row('d-sep-01', at(2026, 8, 1, 10, 0, 0), { amount: 400 }),
      row('d-sep-20-dead', at(2026, 8, 20, 10, 0, 0), { amount: 900, deleted_at: at(2026, 9, 4, 10, 0, 0) }),
      row('d-oct-01', at(2026, 9, 1, 10, 0, 0), { amount: 500 }),
    ],
    tasks: [
      row('t-sep-02', at(2026, 8, 2, 8, 0, 0)),
      row('t-sep-03-dead', at(2026, 8, 3, 8, 0, 0), { deleted_at: at(2026, 9, 6, 8, 0, 0) }),
    ],
    support_tickets: [
      row('s-sep-10', at(2026, 8, 10, 18, 0, 0)),
      row('s-oct-02', at(2026, 9, 2, 18, 0, 0)),
    ],
    companies: [row('co-sep-11', at(2026, 8, 11, 16, 0, 0))],
    email_log: [row('e-sep-12', at(2026, 8, 12, 17, 0, 0))],
  };
}

let data: Record<string, Row[]>;
let statements: { sql: string; params: unknown[] }[];

function fragmentFor(sqlText: string, alias: string): string {
  const here = sqlText.indexOf(`AS "${alias}"`);
  if (here === -1) throw new Error(`no subselect answers ${alias}`);
  return sqlText.slice(sqlText.lastIndexOf('(SELECT', here), here);
}

function ordinal(f: string, term: RegExp): number | undefined {
  const m = f.match(term);
  return m ? Number(m[1]) : undefined;
}

/** Answer one fragment the way Postgres would: by its own bound parameters. */
function answerFragment(q: { sql: string; params: unknown[] }, alias: string): unknown {
  const frag = fragmentFor(q.sql, alias);
  const rows = data[frag.match(/FROM "(\w+)"/)?.[1] ?? ''] ?? [];
  const tenantN = ordinal(frag, /"tenant_id" = \$(\d+)/);
  const fromN = ordinal(frag, /"created_at" >= \$(\d+)/);
  const toN = ordinal(frag, /"created_at" < \$(\d+)/);
  const tombstone = /"deleted_at" IS NULL/i.test(frag);
  const tenant = tenantN === undefined ? undefined : q.params[tenantN - 1];
  const from = fromN === undefined ? undefined : (q.params[fromN - 1] as Date);
  const to = toN === undefined ? undefined : (q.params[toN - 1] as Date);

  const inside = rows.filter((r) => {
    if (tenant !== undefined && r.tenant_id !== tenant) return false;
    if (tombstone && r.deleted_at !== null) return false;
    if (from !== undefined && !(r.created_at >= from)) return false;
    if (to !== undefined && !(r.created_at < to)) return false;
    return true;
  });
  return /coalesce\(sum\(/i.test(frag)
    ? String(inside.reduce((sum, r) => sum + (r.amount ?? 0), 0))
    : inside.length;
}

const ALIASES = [
  'thisMonthContacts', 'thisMonthDeals', 'thisMonthTasks', 'thisMonthTickets',
  'thisMonthCompanies', 'thisMonthEmails', 'lastMonthContacts', 'lastMonthDeals',
  'lastMonthTasks', 'totalContacts', 'totalDeals', 'totalTasks', 'totalTickets',
  'totalCompanies', 'thisMonthDealValue', 'totalDealValue',
];

const mockDb: Record<string, unknown> = {
  execute: vi.fn(async (query: unknown) => {
    const rendered = dialect.sqlToQuery(query as never);
    const q = { sql: rendered.sql, params: rendered.params as unknown[] };
    statements.push(q);
    const out: Record<string, unknown> = {};
    for (const alias of ALIASES) out[alias] = answerFragment(q, alias);
    return { rows: [out] };
  }),
  select: vi.fn(() => {
    const builder: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit']) builder[m] = () => builder;
    builder['then'] = (resolve: (v: unknown[]) => unknown) => resolve([]);
    return builder;
  }),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/read-rate-limit', () => ({ rateLimitRead: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/analytics/usage/route');

interface UsageData {
  thisMonth: Record<string, number>;
  lastMonth: Record<string, number>;
  totals: Record<string, number>;
}

async function getUsage(): Promise<{ data: UsageData }> {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: USER, tenantId: TENANT, roleSlug: 'manager', permissions: { 'all': true },
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext);
  const res = await (route.GET as (r: NextRequest) => Promise<Response>)(
    new NextRequest(new URL('http://localhost:3000/api/tenant/analytics/usage'), {
      method: 'GET', headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`usage GET answered ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as { data: UsageData };
}

/**
 * The fragment with its window terms removed. What is left is the population the
 * count reads, and it is compared literally so that no predicate can differ between
 * the two sides of a trend without failing here. Placeholder ordinals are collapsed
 * first: every subselect in the statement re-binds `tenant_id`, so `$5` and `$19`
 * are the same value, and this test grades the predicates, not drizzle's numbering.
 */
function predicates(frag: string): string {
  return frag
    .replace(/AND\s+"?\w*"?\."?created_at"? >= \$\d+/gi, '')
    .replace(/AND\s+"?\w*"?\."?created_at"? < \$\d+/gi, '')
    .replace(/\$\d+/g, '$')
    .replace(/\s+/g, ' ')
    .trim();
}

beforeEach(() => {
  data = fixtures();
  statements = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function pinOct17() {
  vi.useFakeTimers();
  vi.setSystemTime(at(2026, 9, 17, 12, 0, 0));
}

describe('the lastMonth baseline reads the same population as its siblings (#2758)', () => {
  it.each(['Contacts', 'Deals', 'Tasks'])(
    'the %S baseline fragment carries the tombstone term',
    async (suffix) => {
      pinOct17();
      await getUsage();
      const frag = fragmentFor(statements[0].sql, `lastMonth${suffix}`);
      expect(frag).toMatch(/"deleted_at" IS NULL/i);
    },
  );

  it.each(['Contacts', 'Deals', 'Tasks'])(
    'strip the window and the %S pair is the same predicate list — thisMonth vs lastMonth',
    async (suffix) => {
      pinOct17();
      await getUsage();
      const sqlText = statements[0].sql;
      expect(predicates(fragmentFor(sqlText, `lastMonth${suffix}`)))
        .toBe(predicates(fragmentFor(sqlText, `thisMonth${suffix}`)));
    },
  );

  it('the baseline, the totals and the value sums all agree on the population', async () => {
    pinOct17();
    await getUsage();
    const sqlText = statements[0].sql;
    const baseline = predicates(fragmentFor(sqlText, 'lastMonthDeals'));
    expect(predicates(fragmentFor(sqlText, 'totalDeals'))).toBe(baseline);
    expect(predicates(fragmentFor(sqlText, 'totalDealValue'))).toContain('"deleted_at" IS NULL');
    expect(predicates(fragmentFor(sqlText, 'thisMonthDealValue'))).toContain('"deleted_at" IS NULL');
  });

  it('counts a live September contact and not a tombstoned one', async () => {
    pinOct17();
    const json = await getUsage();
    // Sep 5, Sep 12, Sep 30. Sep 20 is soft-deleted Oct 3 and is out, exactly as it
    // is out of `thisMonth` and out of `totals`.
    expect(json.data.lastMonth.contacts).toBe(3);
    expect(json.data.totals.contacts).toBe(4);
    expect(json.data.thisMonth.contacts).toBe(1);
  });

  it('does not let a tombstone inflate the trend denominator', async () => {
    pinOct17();
    const json = await getUsage();
    // Before #2758 the baseline read 4 (three live + one deleted) and divided a
    // September into an October that never contained that row at all.
    const ratio = json.data.thisMonth.contacts / json.data.lastMonth.contacts;
    expect(ratio).toBeLessThan(1);
    expect(json.data.lastMonth.deals).toBe(1);   // d-sep-01; d-sep-20-deal is deleted
    expect(json.data.lastMonth.tasks).toBe(1);   // t-sep-02; t-sep-03-dead is deleted
  });

  it('keeps a cross-tenant row out of both sides', async () => {
    pinOct17();
    const json = await getUsage();
    expect(json.data.lastMonth.contacts).toBe(3);  // c-other-sep is not in it
    expect(json.data.totals.contacts).toBe(4);
  });
});

describe('the tables with no deleted_at column keep no tombstone term', () => {
  /**
   * The reverse guard. `support_tickets` (`drizzle/schema/support.ts:95-137`) and
   * `email_log` (`drizzle/schema/comm.ts:218`) have no `deleted_at`, so a reference
   * there is `undefined` at runtime and drizzle emits nothing for it — the rendered
   * SQL ends in `… AND  IS NULL`, which Postgres rejects, and the endpoint 500s.
   * Symmetry with the fix above must not be "fixed" by adding the term here.
   */
  it.each(['Tickets', 'Emails'])(
    'the thisMonth%S fragment does NOT mention deleted_at',
    async (suffix) => {
      pinOct17();
      await getUsage();
      const frag = fragmentFor(statements[0].sql, `thisMonth${suffix}`);
      expect(frag).not.toMatch(/deleted_at/i);
    },
  );

  it('and totalTickets does not either, while the counts still answer', async () => {
    pinOct17();
    const json = await getUsage();
    const frag = fragmentFor(statements[0].sql, 'totalTickets');
    expect(frag).not.toMatch(/deleted_at/i);
    expect(json.data.thisMonth.tickets).toBe(1);
    expect(json.data.totals.tickets).toBe(2);
  });
});
