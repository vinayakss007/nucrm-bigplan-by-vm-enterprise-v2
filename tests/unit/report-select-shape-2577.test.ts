/* eslint-disable @typescript-eslint/no-explicit-any */
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2577 — `POST /api/tenant/reports/run` answered
 * `RangeError: Maximum call stack size exceeded` (Sentry group 7760913775, 15
 * events, last seen 2026-09-29). The issue asks for a reproduction before any
 * code change, so this file is the reproduction and the guard, not a blind fix.
 *
 * The payload is `db.select(<array of bare column-name strings>)`, which is
 * exactly what the endpoint ran until 3836629f (2026-10-02):
 *
 *     columns: ['title', 'value', 'stage', 'probability', 'close_date', …]
 *     db.select(reportConfig.columns).from(reportConfig.table)
 *
 * drizzle's `SelectQueryBuilder` treats a non-object `fields` argument as a
 * relational sub-`select`, so a string array recurses in `src/utils.ts` until
 * the stack overflows. The first test below drives that against a real drizzle
 * instance — no database, `toSQL()` alone — and the rest assert the route can no
 * longer produce that shape for any report type. Every event in the cluster is
 * older than the fix, which is consistent with it being gone; pinning the
 * invariant is what keeps it gone, because nothing else in the file stops a
 * future `columns: string[]` from being threaded straight back into `db.select`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { desc } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({ selections: [] as unknown[], tables: [] as unknown[] }));

vi.mock('@/drizzle/db', () => {
  const chain: any = {
    from: (table: unknown) => { h.tables.push(table); return chain; },
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (res: any, rej?: any) => Promise.resolve([]).then(res, rej),
  };
  return { db: { select: (fields: unknown) => { h.selections.push(fields); return chain; } } };
});

import {
  runReportForTenant,
  REPORT_TYPES,
  REPORT_ROW_TYPES,
  REPORT_AGGREGATES,
} from '@/app/api/tenant/reports/run/route';
import { REPORT_COLUMNS } from '@/lib/reports/report-columns';
import { contacts, companies, deals, tasks, leads } from '@/drizzle/schema';

const TENANT = '11111111-1111-4111-8111-111111111111';

// The table each report type reads — the aggregate entries name their base
// table, which is what the route's own registry does for `filters`.
const TABLES: Record<string, AnyPgTable> = {
  contacts, companies, deals, tasks, leads,
  pipeline: deals, revenue: deals,
};

// A real drizzle handle over a session that is never used: `toSQL()` builds the
// query and throws the RangeError the endpoint threw, without touching Postgres.
const renderer = drizzle({} as never, { schema: { contacts, companies, deals, tasks, leads } });

function render(fields: unknown, table: AnyPgTable): string {
  return (renderer as any).select(fields as never).from(table).orderBy(desc((table as any).createdAt)).limit(100).toSQL().sql;
}

function isRenderable(value: unknown): boolean {
  const v = value as { getSQLType?: unknown; getSQL?: unknown };
  return typeof v?.getSQLType === 'function' || typeof v?.getSQL === 'function';
}

async function run(reportType: string, body: Record<string, unknown> = {}) {
  h.selections = [];
  h.tables = [];
  const out = await runReportForTenant(TENANT, { report_type: reportType, ...body });
  return { out, selection: h.selections[0] };
}

beforeEach(() => { vi.clearAllMocks(); h.selections = []; h.tables = []; });

describe('the crash input, reproduced (#2577)', () => {
  it('db.select() given an array of column-name strings overflows the stack', () => {
    const columns = ['title', 'amount', 'stage', 'close_date', 'created_at'];
    let caught: unknown = null;
    try {
      render(columns, deals);
    } catch (e) {
      caught = e;
    }
    expect(caught, 'the shape that caused Sentry 7760913775 no longer crashes drizzle — re-check this test').toBeInstanceOf(RangeError);
    expect(String((caught as Error).message)).toMatch(/Maximum call stack size exceeded/i);
  });

  it('the same names as an object of column references render fine', () => {
    const selection = { title: deals.title, amount: deals.amount, created_at: deals.createdAt };
    expect(render(selection, deals)).toMatch(/select .*/);
  });
});

describe('no report type hands drizzle a bare name', () => {
  it.each(REPORT_TYPES)('%s', async (reportType) => {
    const { out, selection } = await run(reportType);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(selection, `${reportType} never reached db.select`).toBeDefined();

    for (const [name, value] of Object.entries(selection as Record<string, unknown>)) {
      expect(typeof value === 'string', `${reportType}.${name} is the bare string that recurses`).toBe(false);
      expect(Array.isArray(value), `${reportType}.${name} is an array`).toBe(false);
      expect(value, `${reportType}.${name} is null/undefined`).not.toBeNull();
      expect(isRenderable(value), `${reportType}.${name} is neither a column nor an expression`).toBe(true);
    }

    // The assertion that matters: the object the route actually built renders.
    expect(() => render(selection, TABLES[reportType]), reportType).not.toThrow();
  });
});

describe('what each report returns is what each report advertises', () => {
  it('every row type selects exactly its advertised columns, in order', async () => {
    for (const reportType of REPORT_ROW_TYPES) {
      const { selection } = await run(reportType);
      expect(Object.keys(selection as object), reportType).toEqual([...REPORT_COLUMNS[reportType as keyof typeof REPORT_COLUMNS]]);
    }
  });

  it('the aggregates select their fixed shape', async () => {
    for (const reportType of Object.keys(REPORT_AGGREGATES)) {
      const { selection } = await run(reportType);
      expect(Object.keys(selection as object), reportType).toEqual(Object.keys(REPORT_AGGREGATES[reportType].select));
    }
  });
});

describe('a bad request is answered before the query is built', () => {
  it('an unknown report type is a 400 with no selection', async () => {
    const { out, selection } = await run('nope');
    expect(out).toMatchObject({ status: 400, error: /Invalid report type/i });
    expect(selection).toBeUndefined();
  });

  it('a caller-posted `columns` array cannot reach db.select', async () => {
    // The route reads its column list from REPORT_COLUMNS, not from the request —
    // so the payload that produced the crash is inert here. Pinned because a
    // future "let the caller choose columns" change re-opens #2577 unless the
    // names are resolved through `resolveField` first.
    const { selection } = await run('deals', { columns: ['title', 'amount'] });
    expect(Object.values(selection as Record<string, unknown>).some(v => typeof v === 'string')).toBe(false);
  });

  it('a filter naming a column the table does not have is a 400, not a crash', async () => {
    const { out, selection } = await run('deals', { filters: { value: '1000' } });
    expect(out).toMatchObject({ status: 400, error: /Unknown field/i });
    expect(selection).toBeUndefined();
  });
});
