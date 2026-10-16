/* eslint-disable @typescript-eslint/no-explicit-any */
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2657 — `runReportForTenant` has two branches, and only the row branch read
 * the request's `filters`. `pipeline` and `revenue` built their WHERE from the
 * tenant, the tombstone predicate (#2389) and the entry's own fixed `where`,
 * and threw `body.filters` away: a report "filtered" on stage, amount or owner
 * answered every deal in the tenant and still reported `report_type: pipeline`
 * as though it had honoured them.
 *
 * Tombstones in this same branch were the identical defect and are pinned by
 * `report-aggregate-softdelete-2389.test.ts`; this file pins filters, which
 * reach the aggregate through the aggregate's own base table — `pipeline` is
 * not a key in `TABLES`, so resolving a `pipeline` filter by report type would
 * have 400'd on a field the schema knows perfectly well.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { deals } from '@/drizzle/schema';
import { REPORT_AGGREGATES, resolveField } from '@/app/api/tenant/reports/run/route';

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
function where(): { sql: string; params: unknown[] } {
  expect(h.wheres, 'the report built no WHERE clause').toHaveLength(1);
  const q = dialect.sqlToQuery(h.wheres[0] as never);
  return { sql: q.sql, params: q.params };
}

async function run(reportType: string, filters?: unknown) {
  h.wheres = [];
  h.table = null;
  const mod = await import('@/app/api/tenant/reports/run/route');
  const out = await mod.runReportForTenant('11111111-1111-4111-8111-111111111111', {
    report_type: reportType,
    ...(filters === undefined ? {} : { filters }),
  });
  return { out, mod };
}

beforeEach(() => { vi.clearAllMocks(); h.wheres = []; h.table = null; });

describe('aggregate reports apply the request filters (#2657)', () => {
  it.each(['pipeline', 'revenue'])('%s filters on a plain column', async (reportType) => {
    const { out } = await run(reportType, { assigned_to: '22222222-2222-4222-8222-222222222222' });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(h.table, 'aggregate is not reading the deals table this test assumes').toBe(deals);
    const { sql, params } = where();
    expect(sql).toMatch(/"?assigned_to"?\s*=/i);
    expect(params).toContain('22222222-2222-4222-8222-222222222222');
  });

  it.each(['pipeline', 'revenue'])('%s honors an operator, not just equality', async (reportType) => {
    const { out } = await run(reportType, { amount: { value: '100000', op: 'gt' } });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql, params } = where();
    expect(sql).toMatch(/"?amount"?\s*(?:::)?\s*>/i);
    expect(params.map(String)).toContain('100000');
  });

  it('a stage filter resolves against the aggregate base table, not the report name', async () => {
    // `pipeline` and `revenue` are not keys in TABLES: resolving their filters by
    // report type would answer 400 "Unknown field 'stage' for report 'pipeline'"
    // for a field the builder offers on every deals report.
    const { out } = await run('pipeline', { stage: 'Won' });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql, params } = where();
    expect(sql).toMatch(/deal_stages/i);
    expect(params).toContain('Won');
  });

  it('revenue keeps its closed-business predicate alongside the filter', async () => {
    const { out } = await run('revenue', { stage: 'Won' });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql } = where();
    expect(sql).toMatch(/"?won_at"?\s+is not null/i);
    expect(sql).toMatch(/deal_stages/i);
    expect(sql).toMatch(/"?deleted_at"?\s+is null/i);
  });

  it('a filter the schema cannot answer is a 400, not a silently dropped filter', async () => {
    const { out } = await run('pipeline', { not_a_column: 'x' });
    expect(out).toMatchObject({ status: 400, error: /Unknown field 'not_a_column'/ });
  });

  it('no filters means no extra predicate (the WHERE is the same query as before)', async () => {
    const { out } = await run('pipeline');
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql } = where();
    expect(sql).not.toMatch(/assigned_to|"amount"|deal_stages/i);
    expect(sql).toMatch(/"?tenant_id"?\s*=/i);
  });

  it('the row branch still applies them (the branch that was already right)', async () => {
    const { out } = await run('deals', { amount: { value: '100000', op: 'lt' } });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(where().sql).toMatch(/"?amount"?\s*(?:::)?\s*</i);
  });
});

describe('an aggregate cannot be added whose filterKey reads a different table', () => {
  const entries = Object.entries(REPORT_AGGREGATES) as [string, { filterKey: string; table: unknown }][];

  it('there is at least one aggregate to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)(
    '%s resolves its filters against the table it actually queries',
    (_reportType, agg) => {
      const col = resolveField(agg.filterKey, 'tenant_id') as { table?: unknown };
      expect(
        col.table,
        `${_reportType}: filterKey '${agg.filterKey}' is not the table it reads`,
      ).toBe(agg.table);
    },
  );
});
