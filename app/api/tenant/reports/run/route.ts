/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, tasks, leads } from '@/drizzle/schema';
import { eq, and, desc, sql, gt, lt, inArray, getTableColumns, type SQL } from 'drizzle-orm';
import type { PgTableWithColumns } from 'drizzle-orm/pg-core';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { REPORT_COLUMNS } from '@/lib/reports/report-columns';

 
 

// deals.stage_id is a uuid. Both aggregates and the deals report expose the
// stage's *name* under the key `stage`, because a bar labelled with an
// unparseable id is not a report. Correlated on the outer FROM, which is always
// the entity's own table.
const DEAL_STAGE_EXPR = sql`(select ds.name from deal_stages ds where ds.id = deals.stage_id and ds.tenant_id = deals.tenant_id)::text`;

// Keys here are what the caller sees; values are the expressions that produce
// them. Anything not listed must be a real column on the table.
const DERIVED: Record<string, Record<string, SQL>> = {
  contacts: {
    company_name: sql`(select co.name from companies co where co.id = contacts.company_id and co.tenant_id = contacts.tenant_id)::text`,
  },
  deals: {
    stage: DEAL_STAGE_EXPR,
    company_name: sql`(select co.name from companies co where co.id = deals.company_id and co.tenant_id = deals.tenant_id)::text`,
    contact_name: sql`(select concat(c.first_name, ' ', c.last_name) from contacts c where c.id = deals.contact_id and c.tenant_id = deals.tenant_id)::text`,
  },
  companies: {
    // `size` is the name every client of this API already uses; the column is
    // company_size.
    size: sql`companies.company_size::text`,
  },
  tasks: {
    contact_name: sql`(select concat(c.first_name, ' ', c.last_name) from contacts c where c.id = tasks.contact_id and c.tenant_id = tasks.tenant_id)::text`,
  },
  leads: {},
  pipeline: {},
  revenue: {},
};

/** A name the schema cannot answer — bad input, answered 400. */
export class UnknownReportFieldError extends Error {
  constructor(table: string, field: string) {
    super(`Unknown field '${field}' for report '${table}'`);
    this.name = 'UnknownReportFieldError';
  }
}

/** A filter value the column cannot hold — bad input, answered 400. */
export class UnusableReportFilterValueError extends Error {
  constructor(field: string, value: unknown) {
    super(`Filter value '${String(value).slice(0, 40)}' is not a date, and '${field}' is a date column`);
    this.name = 'UnusableReportFilterValueError';
  }
}

function columnsBySqlName(table: object): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const col of Object.values(getTableColumns(table as never))) {
    const name = (col as { name?: string }).name;
    if (name) out.set(name, col);
  }
  return out;
}

/**
 * Public name → the expression that produces it.
 *
 * `db.select()` does not accept bare column-name strings: an array of strings
 * recurses until the stack overflows, so the whole endpoint answered 500 for
 * every report type — there is no Postgres error to read, the query never got
 * built. Names are resolved against the table's own columns here, which also
 * turns the drifted lists (deals.value, companies.employee_count, leads.status)
 * into a 400 we control instead of a crash.
 */
export function resolveField(tableKey: string, name: string): unknown {
  const derived = DERIVED[tableKey];
  if (derived && name in derived) return derived[name];
  const table = TABLES[tableKey];
  if (!table) throw new UnknownReportFieldError(tableKey, name);
  const col = columnsBySqlName(table).get(name);
  if (!col) throw new UnknownReportFieldError(tableKey, name);
  return col;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLES: Record<string, PgTableWithColumns<any>> = { contacts, companies, deals, tasks, leads };

function buildSelection(tableKey: string, names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = resolveField(tableKey, name);
  return out;
}

/**
 * A timestamp column cannot bind a string: drizzle maps the value with
 * `column.toDriverValue`, which calls `.toISOString()`, so any string — the
 * shape every filter arrives in, and what a saved report stores — threw a
 * TypeError and the endpoint answered 500. Parse here, and refuse a value that
 * is not a date rather than binding `Invalid Date` and letting Postgres judge.
 */
function coerceFilterValue(expr: unknown, field: string, value: unknown): unknown {
  const getSQLType = (expr as { getSQLType?: () => string } | null)?.getSQLType;
  const sqlType = typeof getSQLType === 'function' ? getSQLType.call(expr) : '';
  if (!/timestamp|date/.test(sqlType)) return value;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new UnusableReportFilterValueError(field, value);
  return parsed;
}

/** `filters` accepts `"value"` (equals) or `{ value, op }`. */
export function filterCondition(tableKey: string, field: string, raw: unknown): SQL {
  const expr = resolveField(tableKey, field) as never;
  const value = typeof raw === 'object' && raw !== null && 'value' in raw
    ? (raw as { value: unknown }).value
    : raw;
  const op = typeof raw === 'object' && raw !== null && 'op' in raw
    ? String((raw as { op: unknown }).op)
    : 'equals';

  if (value === null || value === undefined || value === '') {
    return op === 'is_null' ? sql`${expr} is null` : sql`true`;
  }
  const usable = coerceFilterValue(expr, field, value);
  switch (op) {
    case 'contains': return sql`${expr}::text ilike ${`%${String(value)}%`}`;
    case 'gt': return gt(expr as never, usable as never);
    case 'lt': return lt(expr as never, usable as never);
    case 'in': {
      const list = Array.isArray(usable) ? usable : String(usable).split(',').map(s => s.trim()).filter(Boolean);
      if (list.length === 0) return sql`false`;
      return inArray(expr as never, list.map(item => coerceFilterValue(expr, field, item)) as never);
    }
    default: return eq(expr as never, usable as never);
  }
}

// Aggregates keep their own selection because their shape is fixed: one
// dimension plus the counts. Exported only so the test can render them.
export const REPORT_AGGREGATES: Record<string, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTableWithColumns<any>;
  select: Record<string, unknown>;
  groupBy: SQL;
  where?: SQL;
}> = {
  pipeline: {
    table: deals,
    select: {
      stage: DEAL_STAGE_EXPR,
      count: sql`count(*)::int`,
      total_value: sql`sum(deals.amount::numeric)::numeric`,
    },
    groupBy: DEAL_STAGE_EXPR,
  },
  revenue: {
    table: deals,
    select: {
      stage: DEAL_STAGE_EXPR,
      count: sql`count(*)::int`,
      revenue: sql`sum(deals.amount::numeric)::numeric`,
    },
    groupBy: DEAL_STAGE_EXPR,
    // "Revenue" means closed business. The declarative `filters: [{field,value}]`
    // this config used to carry was never read by the handler, so the report
    // totalled every open and lost deal too and the number was wrong silently.
    where: sql`${deals.wonAt} is not null`,
  },
};

// Exported only so the test can assert every advertised name resolves.
export const REPORT_ROW_TYPES = Object.keys(REPORT_COLUMNS).filter(k => !(k in REPORT_AGGREGATES));

/** Everything `runReportForTenant` will actually run — rows or aggregates. */
export const REPORT_TYPES = [...Object.keys(REPORT_COLUMNS), ...Object.keys(REPORT_AGGREGATES)];

export type ReportRunFailure = { error: string; status: number };
export type ReportRunSuccess = { rows: Record<string, unknown>[]; reportType: string };

/**
 * The report executor.
 *
 * Exported because a saved report runs through exactly this code: the run
 * handler used to call `public.execute_saved_report`, a plpgsql stub that
 * returned `{rows: [], total: 0}` whatever the data was, so pressing "Run" on
 * any saved report answered a confident empty table.
 */
export async function runReportForTenant(
  tenantId: string,
  body: Record<string, unknown>,
): Promise<ReportRunSuccess | ReportRunFailure> {
  const reportType = typeof body.report_type === 'string' ? body.report_type : '';
  const filters = body.filters;
  const limit = body.limit ?? 100;

  try {
    const aggregate = REPORT_AGGREGATES[reportType];
    if (!aggregate && !(reportType in REPORT_COLUMNS)) {
      return { error: 'Invalid report type', status: 400 };
    }

    let query;
    let conditions;
    if (aggregate) {
      conditions = [eq(aggregate.table.tenantId, tenantId) as never];
      if (aggregate.where) conditions.push(aggregate.where as never);
      query = db
        .select(aggregate.select as never)
        .from(aggregate.table as never)
        .where(and(...conditions))
        .groupBy(aggregate.groupBy as never);
    } else {
      const table = TABLES[reportType];
      if (!table) return { error: 'Invalid report type', status: 400 };
      conditions = [eq(table.tenantId, tenantId) as never];
      if (table.deletedAt) {
        conditions.push(sql`${table.deletedAt} IS NULL` as never);
      }
      // Filters are applied for every field the report actually returns. The
      // handler used to look for four hard-coded keys and drop everything else,
      // so a report "filtered" on industry, amount or stage silently returned
      // the whole table and still presented itself as filtered.
      if (filters && typeof filters === 'object' && !Array.isArray(filters)) {
        for (const [field, raw] of Object.entries(filters as Record<string, unknown>)) {
          conditions.push(filterCondition(reportType, field, raw) as never);
        }
      }
      const names = REPORT_COLUMNS[reportType as keyof typeof REPORT_COLUMNS];
      if (!names) return { error: 'Invalid report type', status: 400 };
      query = db
        .select(buildSelection(reportType, names) as never)
        .from(table)
        .where(and(...conditions))
        .orderBy(desc(table.createdAt))
        .limit(Math.min(Number(limit) || 100, 1000));
    }

    const rows = (await query) as Record<string, unknown>[];
    return { rows, reportType };
  } catch (err) {
    // An unknown field is bad input, not an outage. It used to reach drizzle and
    // either overflow the stack (500) or throw inside Postgres. Resolution
    // happens while building the query, so this has to cover the build too.
    if (err instanceof UnknownReportFieldError || err instanceof UnusableReportFilterValueError) {
      return { error: err.message, status: 400 };
    }
    throw err;
  }
}

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const result = await runReportForTenant(ctx.tenantId, await readJsonBody(request));
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      data: result.rows,
      meta: {
        count: result.rows.length,
        report_type: result.reportType,
        generated_at: new Date().toISOString(),
      },
    });
 

 
  } catch (err) {
    await logError({ error: err, context: 'report run POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
