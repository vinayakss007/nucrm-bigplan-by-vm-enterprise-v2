/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi } from 'vitest';
import { QueryBuilder, PgDialect } from 'drizzle-orm/pg-core';
import { getTableColumns } from 'drizzle-orm';

// The route module pulls the db pool in at import; nothing here touches it.
vi.mock('@/drizzle/db', () => ({ db: {} }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: async () => null, can: () => true }));

import { REPORT_COLUMNS } from '@/lib/reports/report-columns';
import {
  resolveField,
  REPORT_AGGREGATES,
  UnknownReportFieldError,
} from '@/app/api/tenant/reports/run/route';
import { contacts, companies, deals, tasks, leads } from '@/drizzle/schema';

const TABLES: Record<string, object> = { contacts, companies, deals, tasks, leads };
const ROW_TYPES = ['contacts', 'companies', 'deals', 'tasks', 'leads'];

function selectionFor(type: string): Record<string, unknown> {
  const selection: Record<string, unknown> = {};
  for (const name of REPORT_COLUMNS[type as keyof typeof REPORT_COLUMNS]) selection[name] = resolveField(type, name);
  return selection;
}

function render(type: string) {
  return new QueryBuilder(new PgDialect())
    .select(selectionFor(type) as never)
    .from(TABLES[type] as never)
    .toSQL().sql;
}

describe('custom report column contract', () => {
  it('resolves every advertised column for every row report', () => {
    for (const type of ROW_TYPES) {
      const list = REPORT_COLUMNS[type as keyof typeof REPORT_COLUMNS];
      expect(list, `${type} has no advertised columns`).not.toHaveLength(0);
      for (const name of list) {
        expect(() => resolveField(type, name), `${type}.${name}`).not.toThrow();
      }
    }
  });

  it('maps each advertised name onto a real column or a declared expression', () => {
    // Derived keys are the ones the report invents (join labels, aliases); every
    // other name must exist on the table with that exact SQL name. A list kept
    // in one place and audited against the schema is the point of this file —
    // the drift it replaces (deals.value, companies.employee_count,
    // leads.status) made four of seven reports throw.
    const derived = new Set(['company_name', 'contact_name', 'stage', 'size']);
    for (const type of ROW_TYPES) {
      const sqlNames = new Set(
        Object.values(getTableColumns(TABLES[type] as never)).map((c: { name: string }) => c.name),
      );
      for (const name of REPORT_COLUMNS[type as keyof typeof REPORT_COLUMNS]) {
        if (derived.has(name)) continue;
        expect(sqlNames.has(name), `${type}.${name} is not a column`).toBe(true);
      }
    }
  });

  it('renders each row report to SQL', () => {
    for (const type of ROW_TYPES) {
      expect(() => render(type), `${type} failed to render`).not.toThrow();
      // The object keys are what the response rows are keyed by, so the list the
      // UI offers and the shape the API returns are pinned to each other here.
      expect(Object.keys(selectionFor(type)), type).toEqual([...REPORT_COLUMNS[type as keyof typeof REPORT_COLUMNS]]);
    }
  });

  it('rejects a name the schema cannot answer', () => {
    expect(() => resolveField('deals', 'value')).toThrow(UnknownReportFieldError);
    expect(() => resolveField('companies', 'employee_count')).toThrow(UnknownReportFieldError);
    expect(() => resolveField('leads', 'status')).toThrow(UnknownReportFieldError);
    expect(() => resolveField('nope', 'id')).toThrow(UnknownReportFieldError);
  });

  it('renders each aggregate with its dimension in GROUP BY, unaliased', () => {
    const dialect = new PgDialect();
    for (const [name, agg] of Object.entries(REPORT_AGGREGATES)) {
      const built = new QueryBuilder(dialect)
        .select(agg.select as never)
        .from(agg.table as never)
        .groupBy(agg.groupBy as never)
        .toSQL().sql;
      expect(built, `${name} lost its dimension`).toContain('group by');
      // An `as label` inside GROUP BY is a Postgres syntax error, which is what
      // happens if the aliased SELECT fragment is reused for the grouping.
      expect(built.split('group by')[1]).not.toMatch(/\bas\s+i/i);
      expect(built.split('group by')[1]).not.toContain('as stage');
      if (name === 'revenue') {
        expect(built).toContain('deal_stages');
        expect(dialect.sqlToQuery(agg.where!).sql).toContain('won_at');
      }
    }
  });

  it('documents why names are resolved instead of passed through', () => {
    // db.select() does not accept bare column-name strings; it recurses until
    // the stack overflows. That is the whole reason /api/tenant/reports/run
    // answered 500 for every report type, even the ones whose columns existed.
    expect(() =>
      new QueryBuilder(new PgDialect()).select(['first_name']).from(contacts as never).toSQL(),
    ).toThrow(RangeError);
  });
});
