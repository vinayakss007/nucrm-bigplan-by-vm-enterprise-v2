/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2756 — the Usage Dashboard's "last month" window dropped its own last day.
 *
 * `app/api/tenant/analytics/usage/route.ts:25` closed the previous month with
 * `new Date(now.getFullYear(), now.getMonth(), 0)`, which JS resolves to *the
 * last calendar day at 00:00* — not the end of that day. The three subselects
 * that use it bind it with `<` (`lastMonthContacts`, `lastMonthDeals`,
 * `lastMonthTasks`), so the window was `[Sep 1 00:00, Sep 30 00:00)`: every
 * record created on the final day of last month was silently excluded, and
 * `app/tenant/settings/usage/page.tsx:56-59` trends exactly those three numbers
 * (`<Trend current={thisMonth} previous={lastMonth} />`). In January it also
 * rolls the year wrong (`[Dec 1, Dec 31)` — New Year's Eve excluded).
 *
 * The exclusive shape was the intent: `thisMonth` already uses `thisMonthStart`
 * with `>=`, and `thisMonthStart` *is* the instant last month ends. One line
 * makes the two windows contiguous, which is what this test grades.
 *
 * `db.execute` is not handed a canned count. It reads the SQL the route actually
 * rendered, pulls each subselect's own `tenant_id = $n`, `created_at >= $n`,
 * `created_at < $n` ordinals and `deleted_at IS NULL` term out of the fragment,
 * binds them from the parameter list, and counts the rows that fall inside — the
 * way Postgres would answer that fragment. A route that closes its window a day
 * early therefore reports a day early, and the assertion fails.
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

const row = (
  id: string, created_at: Date, extra: Partial<Row> = {},
): Row => ({ id, tenant_id: TENANT, created_at, deleted_at: null, ...extra });

/** The September the route was pinned to, plus the rows that must not move. */
function fixtures(): Record<string, Row[]> {
  return {
    contacts: [
      row('c-sep-01', at(2026, 8, 1, 0, 0, 0)),          // opens the window
      row('c-sep-15', at(2026, 8, 15, 9, 0, 0)),
      row('c-sep-29', at(2026, 8, 29, 23, 59, 59)),
      row('c-sep-30-day', at(2026, 8, 30, 12, 0, 0)),    // ← the dropped day
      row('c-sep-30-late', at(2026, 8, 30, 23, 59, 59)),
      row('c-oct-01-midnight', at(2026, 9, 1, 0, 0, 0)), // belongs to this month
      row('c-oct-10', at(2026, 9, 10, 8, 0, 0)),
      row('c-aug-31', at(2026, 7, 31, 23, 0, 0)),        // outside both windows
      row('c-other-tenant', at(2026, 8, 30, 12, 0, 0), { tenant_id: OTHER_TENANT }),
      row('c-deleted', at(2026, 8, 20, 12, 0, 0), { deleted_at: at(2026, 9, 1, 12, 0, 0) }),
    ],
    deals: [
      row('d-sep-30', at(2026, 8, 30, 10, 0, 0), { amount: 1000 }),
      row('d-sep-10', at(2026, 8, 10, 10, 0, 0), { amount: 250 }),
      row('d-oct-05', at(2026, 9, 5, 10, 0, 0), { amount: 500 }),
    ],
    tasks: [
      row('t-sep-30', at(2026, 8, 30, 21, 0, 0)),
      row('t-oct-01', at(2026, 9, 1, 0, 0, 1)),
    ],
    support_tickets: [
      row('s-sep-30', at(2026, 8, 30, 18, 0, 0)),
      row('s-oct-02', at(2026, 9, 2, 18, 0, 0)),
    ],
    companies: [row('co-sep-30', at(2026, 8, 30, 16, 0, 0))],
    email_log: [row('e-sep-30', at(2026, 8, 30, 17, 0, 0))],
  };
}

let data: Record<string, Row[]>;
let statements: { sql: string; params: unknown[] }[];

/** The `(SELECT … ) AS "alias"` fragment the route rendered for one output column. */
function fragmentFor(sqlText: string, alias: string): string {
  const here = sqlText.indexOf(`AS "${alias}"`);
  if (here === -1) throw new Error(`no subselect answers ${alias}`);
  const start = sqlText.lastIndexOf('(SELECT', here);
  return sqlText.slice(start, here);
}

function ordinal(f: string, term: RegExp): number | undefined {
  const m = f.match(term);
  return m ? Number(m[1]) : undefined;
}

/** Answer one fragment the way Postgres would: by its own bound parameters. */
function answerFragment(q: { sql: string; params: unknown[] }, alias: string): unknown {
  const frag = fragmentFor(q.sql, alias);
  const table = frag.match(/FROM "(\w+)"/)?.[1];
  const rows = data[table ?? ''] ?? [];

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

  // pg parses int4 into a number and numeric into a string, and this route hands
  // the count straight into the JSON body — so the shapes here are the shapes
  // the handler really sees.
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

interface UsageData {
  thisMonth: Record<string, number>;
  lastMonth: Record<string, number>;
  totals: Record<string, number>;
}

beforeEach(() => {
  data = fixtures();
  statements = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function pin(clock: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
}

describe('the usage window covers the whole of last month (#2756)', () => {
  it('counts the contacts created on the final day of the previous month', async () => {
    pin(at(2026, 9, 17, 12, 0, 0));
    const json = await getUsage();
    // Sep 1, Sep 15, Sep 29, Sep 30 12:00, Sep 30 23:59:59. The Sep 20 tombstone is
    // NOT one of them: as of #2758 the three `lastMonth` subselects carry the same
    // `deleted_at IS NULL` term their `thisMonth` siblings always had. Before that
    // fix this expectation was 6, and it was written deliberately wrong so that
    // closing #2758 would turn this red on purpose rather than silently.
    expect(json.data.lastMonth.contacts).toBe(5);
  });

  it('binds the exclusive bound that this month starts at, not its last day', async () => {
    pin(at(2026, 9, 17, 12, 0, 0));
    await getUsage();
    const q = statements[0];
    const frag = fragmentFor(q.sql, 'lastMonthContacts');
    const to = q.params[(ordinal(frag, /"created_at" < \$(\d+)/) ?? 0) - 1] as Date;
    const from = q.params[(ordinal(frag, /"created_at" >= \$(\d+)/) ?? 0) - 1] as Date;
    expect(to.getTime()).toBe(at(2026, 9, 1, 0, 0, 0).getTime());
    expect(from.getTime()).toBe(at(2026, 8, 1, 0, 0, 0).getTime());
  });

  it('the two windows tile the calendar — nothing falls between them, nothing lands in both', async () => {
    pin(at(2026, 9, 17, 12, 0, 0));
    const json = await getUsage();
    // The population both subselects read: in-tenant, live rows. As of #2758 the
    // baseline filters the tombstone exactly like `thisMonth` and `totals` do, so
    // one predicate serves all three and the tiling claim is about the windows
    // rather than about two different populations.
    const tenantRows = data.contacts.filter((r) => r.tenant_id === TENANT && r.deleted_at === null);
    const inLast = (r: Row) => r.created_at >= at(2026, 8, 1) && r.created_at < at(2026, 9, 1);
    const inThis = (r: Row) => r.created_at >= at(2026, 9, 1);

    expect(tenantRows.filter((r) => inLast(r) && inThis(r))).toEqual([]);
    const gap = tenantRows.filter((r) => r.created_at >= at(2026, 8, 1) && !inLast(r) && !inThis(r));
    expect(gap).toEqual([]);

    expect(json.data.lastMonth.contacts).toBe(tenantRows.filter(inLast).length);
    expect(json.data.thisMonth.contacts).toBe(tenantRows.filter(inThis).length);
  });

  it('does not double count the boundary row at this month 00:00', async () => {
    pin(at(2026, 9, 17, 12, 0, 0));
    const json = await getUsage();
    expect(json.data.thisMonth.contacts).toBe(2);   // Oct 1 00:00 and Oct 10
    expect(json.data.lastMonth.contacts).toBe(5);   // and the Oct-1 row is not in there too
  });

  it('keeps the tenant and tombstone terms doing the same work they did before', async () => {
    pin(at(2026, 9, 17, 12, 0, 0));
    const json = await getUsage();
    // The cross-tenant Sep 30 row is out of both. The Sep 20 tombstone is now out
    // of the baseline too (#2758): the trend divides `lastMonth` into `thisMonth`,
    // and until both sides filtered `deleted_at` those were two different
    // populations — a contact created Sep 20 and deleted Oct 3 counted in the
    // denominator of a trend that says the tenant lost it.
    expect(json.data.lastMonth.contacts).toBe(5);
    expect(json.data.totals.contacts).toBe(8);
  });

  it('counts the last day for deals and tasks too, not just contacts', async () => {
    pin(at(2026, 9, 17, 12, 0, 0));
    const json = await getUsage();
    expect(json.data.lastMonth.deals).toBe(2);
    expect(json.data.lastMonth.tasks).toBe(1);
  });

  it('rolls the year correctly — a January read covers all of December', async () => {
    data = {
      contacts: [
        row('c-dec-01', at(2026, 11, 1, 0, 0, 0)),
        row('c-dec-31', at(2026, 11, 31, 20, 0, 0)),
        row('c-nov-30', at(2026, 10, 30, 20, 0, 0)),
        row('c-jan-05', at(2027, 0, 5, 9, 0, 0)),
      ],
      deals: [], tasks: [], support_tickets: [], companies: [], email_log: [],
    };
    pin(at(2027, 0, 20, 12, 0, 0));
    const json = await getUsage();
    expect(json.data.lastMonth.contacts).toBe(2);
    expect(json.data.thisMonth.contacts).toBe(1);
  });

  it('a leap February is 29 days, so February 29 is counted', async () => {
    data = {
      contacts: [
        row('c-feb-28', at(2028, 1, 28, 12, 0, 0)),
        row('c-feb-29', at(2028, 1, 29, 23, 0, 0)),
        row('c-mar-01', at(2028, 2, 1, 8, 0, 0)),
      ],
      deals: [], tasks: [], support_tickets: [], companies: [], email_log: [],
    };
    pin(at(2028, 2, 15, 12, 0, 0));
    const json = await getUsage();
    expect(json.data.lastMonth.contacts).toBe(2);
    expect(json.data.thisMonth.contacts).toBe(1);
  });

  it('sums the deal value on the same corrected window shape', async () => {
    pin(at(2026, 9, 17, 12, 0, 0));
    const json = await getUsage();
    expect(json.data.thisMonth.dealValue).toBe(500);
    expect(json.data.totals.dealValue).toBe(1750);
  });
});
