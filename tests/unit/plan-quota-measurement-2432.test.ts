/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2432 — two plan quotas that could never be seen, let alone enforced.
 *
 * `plans.max_storage_gb` and `plans.max_api_calls_day` are sold, defaulted (1 GB /
 * 1,000 calls) and editable in the superadmin plan editor, but `getCount()` read
 * both out of `usage_snapshots` dated today:
 *
 *   * the columns are SUMs over `user_usage`, a table nothing in this repo writes,
 *     so they are 0 for every tenant on every day, and
 *   * `usage_snapshots` only gets a row when the weekly usage-snapshot cron runs
 *     (`vercel.json` `0 0 * * 0`), and the read was an exact `snapshot_date = today`,
 *     so even a working writer would have answered 0 six days out of seven.
 *
 * Both kinds now measure the table that owns the fact. These tests pin that, and
 * each one fails against the pre-fix code (0, and `usage_snapshots` in the FROM).
 *
 * The plan-limit tests cover the second half of the same story: the plan editor
 * renders any negative cap as "Unlimited" (app/superadmin/billing/page.tsx:233),
 * while `exceeded = actual >= limit` treats -1 as a cap that is always passed —
 * which would have locked a tenant out of the resource the operator just
 * unlimited, on the very path this PR turns on.
 *
 * Only `@/drizzle/db` is mocked: the assertions are about the SQL the real
 * drizzle builders produce (tables, columns, soft-delete and tenant predicates),
 * so the real `@/drizzle/schema` and `drizzle-orm` stay unmocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const m = vi.hoisted(() => {
  const state = {
    /** FIFO result arrays for awaited select chains, in call order. */
    selectResults: [] as unknown[][],
    /** Rows returned by `db.execute`, set per test. */
    executeRows: [{ bytes: '0' }] as { bytes: string | null }[],
    fromTables: [] as unknown[],
    whereClauses: [] as unknown[],
    executed: [] as any[],
  };
  const shift = (): unknown[] =>
    state.selectResults.length > 0 ? (state.selectResults.shift() as unknown[]) : [];

  const makeChain = (): any => {
    const chain: any = {};
    chain.from = vi.fn((t: unknown) => { state.fromTables.push(t); return chain; });
    chain.innerJoin = vi.fn(() => chain);
    chain.leftJoin = vi.fn(() => chain);
    chain.where = vi.fn((w: unknown) => { state.whereClauses.push(w); return chain; });
    chain.orderBy = vi.fn(() => chain);
    chain.groupBy = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(shift()).then(onOk, onErr);
    return chain;
  };

  return {
    state,
    makeChain,
    db: {
      select: vi.fn(() => makeChain()),
      execute: vi.fn(async (q: unknown) => {
        state.executed.push(q);
        return { rows: state.executeRows };
      }),
    },
  };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));

import { getCount, getPlanLimits, getUsageReport, type LimitKind } from '@/lib/usage/tracker';
import { apiKeyUsage, contacts, usageSnapshots } from '@/drizzle/schema';

const TENANT = '11111111-1111-4111-8111-111111111111';
const GIB = 1024 ** 3;

const dialect = new PgDialect();

function sqlOf(fragment: any): { text: string; params: unknown[] } {
  // SQL fragments only compile through a dialect; `fragment.toQuery()` needs the
  // session this code never builds. PgDialect is the same one drizzle-pg uses.
  const q = dialect.sqlToQuery(fragment);
  return { text: q.sql, params: q.params };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.selectResults.length = 0;
  m.state.fromTables.length = 0;
  m.state.whereClauses.length = 0;
  m.state.executed.length = 0;
  m.state.executeRows = [{ bytes: '0' }];
});

describe('getCount — storageGb (#2432)', () => {
  it('sums the bytes uploads actually write and converts to GB', async () => {
    m.state.executeRows = [{ bytes: String(3 * GIB) }];

    await expect(getCount(TENANT, 'storageGb')).resolves.toBe(3);

    const { text, params } = sqlOf(m.state.executed[0]);
    // documents  = the table POST /api/tenant/documents writes
    // file_attachments = the table POST /api/tenant/files writes
    expect(text).toContain('"documents"');
    expect(text).toContain('"size_bytes"');
    expect(text).toContain('"file_attachments"');
    expect(text).toContain('"file_size"');
    expect(params).toContain(TENANT);
    // One bound per subquery: neither half may sum another workspace's bytes.
    expect(params.filter((p) => p === TENANT)).toHaveLength(2);
  });

  it('excludes soft-deleted rows, because the object is deleted eagerly', async () => {
    m.state.executeRows = [{ bytes: '1' }];
    await getCount(TENANT, 'storageGb');
    const { text } = sqlOf(m.state.executed[0]);
    expect(text).toMatch(/deleted_at" is null/i);
    expect((text.match(/deleted_at/gi) ?? []).length).toBe(2);
  });

  it('does not read usage_snapshots, and never did after the fix', async () => {
    m.state.executeRows = [{ bytes: String(GIB / 2) }];
    await expect(getCount(TENANT, 'storageGb')).resolves.toBe(0.5);
    expect(m.state.fromTables).not.toContain(usageSnapshots);
  });

  it('reports 0 for a workspace with no uploads rather than inventing usage', async () => {
    m.state.executeRows = [{ bytes: '0' }];
    await expect(getCount(TENANT, 'storageGb')).resolves.toBe(0);
    m.state.executeRows = [{ bytes: null }];
    await expect(getCount(TENANT, 'storageGb')).resolves.toBe(0);
  });

  it('keeps sub-gigabyte precision so a 1 GB plan is not rounded into compliance', async () => {
    m.state.executeRows = [{ bytes: String(Math.round(1.7 * GIB)) }];
    const gb = await getCount(TENANT, 'storageGb');
    expect(gb).toBeCloseTo(1.7, 4);
    const report = await usageReportFor('storageGb', { maxStorageGb: '1.00' });
    expect(report.actual).toBeCloseTo(1.7, 4);
    expect(report.exceeded).toBe(true);
  });
});

describe('getCount — apiCallsDay (#2432)', () => {
  it('counts this tenant\'s API-key calls from the usage ledger', async () => {
    m.state.selectResults = [[{ c: 1234 }]];

    await expect(getCount(TENANT, 'apiCallsDay')).resolves.toBe(1234);

    expect(m.state.fromTables.at(-1)).toBe(apiKeyUsage);
    expect(m.state.fromTables).not.toContain(usageSnapshots);
  });

  it('bounds the window at the start of the UTC day, not the local day', async () => {
    const before = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    m.state.selectResults = [[{ c: 7 }]];
    await getCount(TENANT, 'apiCallsDay');

    const { text, params } = sqlOf(m.state.whereClauses.at(-1));
    expect(text).toContain('>=');
    expect(params).toContain(TENANT);
    // `timestamptz` binds serialise to an ISO string via sqlToQuery, not a Date.
    const bound = params.find((p) => p !== TENANT);
    const cutoff = bound instanceof Date ? bound : new Date(String(bound));
    expect(cutoff.toISOString()).toMatch(/T00:00:00\.000Z$/);
    // The UTC midnight that was in force when the call started.
    expect([cutoff.getTime(), cutoff.getTime() + 86_400_000]).toContain(before);
  });

  it('counts a day with no traffic as 0 rather than missing', async () => {
    m.state.selectResults = [[]];
    await expect(getCount(TENANT, 'apiCallsDay')).resolves.toBe(0);
  });
});

describe('plan limit normalisation (#2432)', () => {
  it('treats a negative cap as unlimited, matching the plan editor', async () => {
    m.state.selectResults = [planRow({ maxContacts: -1, maxApiCallsDay: -1, maxStorageGb: '-1' })];
    const limits = await getPlanLimits(TENANT);
    expect(limits.maxContacts).toBeNull();
    expect(limits.maxApiCallsDay).toBeNull();
    expect(limits.maxStorageGb).toBeNull();
  });

  it('keeps 0 as 0: "nothing allowed", not unlimited', async () => {
    m.state.selectResults = [planRow({ maxContacts: 0 })];
    const limits = await getPlanLimits(TENANT);
    expect(limits.maxContacts).toBe(0);
  });

  it('an unlimited API-call cap must never report the tenant as over quota', async () => {
    // Pre-fix this was the trap: max_api_calls_day = -1 (displayed "Unlimited")
    // satisfied `actual >= limit` for every tenant, so enforcing it would have
    // blocked the API outright.
    m.state.selectResults = [planRow({ maxApiCallsDay: -1 }), [{ c: 99_999 }]];
    const report = await getUsageReport(TENANT, 'apiCallsDay');
    expect(report.limit).toBeNull();
    expect(report.exceeded).toBe(false);
    expect(report.remaining).toBeNull();
  });

  it('coerces the numeric(6,2) storage column', async () => {
    m.state.selectResults = [planRow({ maxStorageGb: '2.50' })];
    const limits = await getPlanLimits(TENANT);
    expect(limits.maxStorageGb).toBe(2.5);
  });
});

describe('the meter no longer depends on the weekly snapshot (#2432)', () => {
  const KINDS: LimitKind[] = [
    'contacts', 'leads', 'deals', 'users', 'automations', 'forms', 'apiCallsDay', 'storageGb',
  ];

  it('no limit kind queries usage_snapshots', async () => {
    for (const kind of KINDS) {
      m.state.selectResults = [[{ c: 0 }]];
      await getCount(TENANT, kind);
    }
    expect(m.state.fromTables).not.toContain(usageSnapshots);
    expect(m.state.fromTables).toContain(apiKeyUsage);
    expect(m.state.executed).toHaveLength(1); // storageGb is the one raw-SUM read
    for (const q of m.state.executed) {
      expect(sqlOf(q).text).not.toMatch(/usage_snapshots/);
    }
  });

  it('still counts the live resources it always counted', async () => {
    m.state.selectResults = [[{ c: 42 }]];
    await expect(getCount(TENANT, 'contacts')).resolves.toBe(42);
    expect(m.state.fromTables.at(-1)).toBe(contacts);
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

function planRow(overrides: Record<string, unknown> = {}) {
  return [{
    maxContacts: 1000,
    maxDeals: 500,
    maxUsers: 5,
    maxAutomations: 5,
    maxForms: 3,
    maxApiCallsDay: 1000,
    maxStorageGb: '1.00',
    ...overrides,
  }];
}

async function usageReportFor(
  kind: LimitKind,
  planOverrides: Record<string, unknown>,
): Promise<{ actual: number; exceeded: boolean; limit: number | null }> {
  m.state.selectResults = [planRow(planOverrides)];
  if (kind === 'storageGb') m.state.executeRows = [{ bytes: String(Math.round(1.7 * GIB)) }];
  else m.state.selectResults.push([{ c: 1 }]);
  return getUsageReport(TENANT, kind);
}
