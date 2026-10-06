/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2389 — the aggregate reports must exclude tombstones, like the row reports do.
 *
 * `runReportForTenant` has two branches. The row branch built
 * `if (table.deletedAt) conditions.push(deletedAt IS NULL)`; the aggregate branch
 * did not, and neither `pipeline` nor `revenue` declares a `where` that covers it.
 * So the pipeline chart and the revenue total counted deleted deals while the
 * exported rows behind the same report did not — the chart and its own detail
 * disagreed, with nothing to explain the difference.
 *
 * The predicate is asserted as rendered SQL (`PgDialect.sqlToQuery`), not by
 * inspecting a mock's return value, and it is asserted for both aggregates so a
 * future aggregate that forgets the column still fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { deals } from '@/drizzle/schema';

const h = vi.hoisted(() => ({ wheres: [] as unknown[], table: null as unknown }));

vi.mock('@/drizzle/db', () => {
  const chain: any = {
    from: (t: unknown) => { h.table = t; return chain; },
    where: (w: unknown) => { h.wheres.push(w); return chain; },
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (res: any, rej?: any) => Promise.resolve([]).then(res, rej),
  };
  return { db: { select: () => chain } };
});

const dialect = new PgDialect();
function whereSql(): string {
  expect(h.wheres, 'the report built no WHERE clause').toHaveLength(1);
  return dialect.sqlToQuery(h.wheres[0] as never).sql;
}

async function run(reportType: string) {
  h.wheres = [];
  h.table = null;
  const mod = await import('@/app/api/tenant/reports/run/route');
  const out = await mod.runReportForTenant('11111111-1111-4111-8111-111111111111', { report_type: reportType });
  expect(out, JSON.stringify(out)).not.toHaveProperty('error');
  return out;
}

beforeEach(() => { vi.clearAllMocks(); h.wheres = []; h.table = null; });

describe('aggregate reports exclude soft-deleted rows (#2389)', () => {
  it.each(['pipeline', 'revenue'])('%s filters deals.deleted_at', async (reportType) => {
    await run(reportType);
    expect(h.table, 'aggregate is not reading the deals table this test assumes').toBe(deals);
    expect(whereSql()).toMatch(/"?deleted_at"?\s+is null/i, `${reportType} aggregate counts deleted deals`);
  });

  it('the tenant predicate is still there alongside it', async () => {
    await run('pipeline');
    const sql = whereSql();
    expect(sql).toMatch(/"?tenant_id"?\s*=/i);
    expect(sql).toMatch(/"?deleted_at"?\s+is null/i);
  });

  it('revenue keeps its "closed business" predicate, it was not replaced', async () => {
    await run('revenue');
    expect(whereSql()).toMatch(/"?won_at"?\s+is not null/i);
  });

  it('row reports still filter tombstones (the branch that was already right)', async () => {
    await run('deals');
    expect(whereSql()).toMatch(/"?deleted_at"?\s+is null/i);
  });
});
