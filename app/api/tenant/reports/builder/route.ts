/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * Custom Report Builder API
 *
 * Deterministic aggregation engine — NO AI.
 * Accepts a report definition and returns chart-ready data.
 *
 * POST /api/tenant/reports/builder
 *
 * Body: {
 *   entity: 'contacts' | 'deals' | 'tasks' | 'companies' | 'activities'
 *           | 'quotes' | 'invoices' | 'tickets' | 'leads',
 *   metric: 'count' | 'sum' | 'avg',
 *   metricField?: string,           // Required for sum/avg (e.g. 'amount' for deals)
 *   groupBy: string,                // Field to group by (e.g., 'lead_status', 'stage', 'priority')
 *   dateRange?: { from: string, to: string },
 *   filters?: Record<string, string | string[]>,  // equality on a groupBy-able field
 *   limit?: number,                 // Max groups to return (default 20)
 * }
 *
 * Returns: {
 *   data: Array<{ label: string, value: number, percentage?: number }>,
 *   total: number,
 *   meta: { entity, metric, groupBy, dateRange, generatedAt }
 * }
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await checkRateLimit(request, { action: 'report-builder', max: 20, windowMinutes: 1 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const {
      entity,
      metric = 'count',
      metricField,
      groupBy,
      dateRange,
      filters = {},
      limit: maxGroups = 20,
    } = body;

    // Validate inputs
    const validEntities = ['contacts', 'deals', 'tasks', 'companies', 'activities', 'quotes', 'invoices', 'tickets', 'leads'];
    if (!validEntities.includes(entity)) {
      return NextResponse.json({ error: `Invalid entity. Use: ${validEntities.join(', ')}` }, { status: 400 });
    }

    const validMetrics = ['count', 'sum', 'avg'];
    if (!validMetrics.includes(metric)) {
      return NextResponse.json({ error: `Invalid metric. Use: ${validMetrics.join(', ')}` }, { status: 400 });
    }

    if (!groupBy) {
      return NextResponse.json({ error: 'groupBy is required' }, { status: 400 });
    }

    if ((metric === 'sum' || metric === 'avg') && !metricField) {
      return NextResponse.json({ error: `metricField is required when metric is ${metric}` }, { status: 400 });
    }

    const tid = ctx.tenantId;
    const safeLimit = Math.min(50, Math.max(1, maxGroups));

    // Build and execute the report query
    const result = await executeReport({
      entity,
      metric,
      metricField,
      groupBy,
      dateRange,
      filters,
      tenantId: tid,
      limit: safeLimit,
    });

    return NextResponse.json({
      data: result.data,
      total: result.total,
      meta: {
        entity,
        metric,
        metricField: metricField || null,
        groupBy,
        dateRange: dateRange || null,
        generatedAt: new Date().toISOString(),
        tenantId: tid,
      },
    });
 
 
  } catch (err) {
    // A dimension the schema cannot answer is bad input. It used to surface as
    // a 500 with a Postgres "column does not exist" behind it, which is both
    // the wrong status and a free error-log flood from a dropdown choice.
    if (err instanceof UnresolvableDimensionError || err instanceof InvalidReportInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return apiError(err);
  }
});

// ── Report Execution Engine ──────────────────────────────────────────────────

interface ReportParams {
  entity: string;
  metric: string;
  metricField?: string;
  groupBy: string;
  dateRange?: { from: string; to: string };
 
 
  filters: Record<string, string | string[]>;
  tenantId: string;
  limit: number;
}

interface ReportResult {
  data: Array<{ label: string; value: number; percentage: number }>;
  total: number;
}

// Allowed group-by fields per entity (whitelist to prevent SQL injection)
//
// These ids are the public contract the builder UI renders from GET below, and
// three of them do not name a real column: deals group by a uuid FK (`stage`,
// stored as `stage_id`), while companies/activities lost a prefix in the schema
// (`size` → `company_size`, `type` → `event_type`). Passing them straight to
// sql.identifier() produced `column "stage" does not exist` — a 500 on the most
// obvious grouping of the most obvious entity. resolveGroupExpression() maps
// them; anything it cannot map is a client error, not a server error.
const ALLOWED_GROUP_FIELDS: Record<string, string[]> = {
  contacts: ['lead_status', 'lead_source', 'created_at_month', 'created_at_week', 'company_id'],
  deals: ['stage', 'created_at_month', 'created_at_week', 'close_date_month', 'assigned_to'],
  tasks: ['priority', 'completed', 'created_at_month', 'created_at_week', 'assigned_to'],
  companies: ['industry', 'size', 'created_at_month'],
  activities: ['type', 'created_at_month', 'created_at_week', 'user_id'],
  quotes: ['status', 'created_at_month', 'created_at_week'],
  invoices: ['status', 'created_at_month', 'created_at_week'],
  tickets: ['status', 'priority', 'category', 'created_at_month', 'created_at_week', 'assigned_to'],
  leads: ['lead_status', 'lead_source', 'created_at_month', 'created_at_week'],
};

// Allowed metric fields per entity
//
// `win_probability` is not a column on deals, so the "Avg Probability" option
// this list used to carry threw on every request. Removed from here and from
// the advertised options below rather than aliased to something unrelated.
const ALLOWED_METRIC_FIELDS: Record<string, string[]> = {
  contacts: ['score'],
  deals: ['amount'],
  tasks: [],
  companies: [],
  activities: [],
  quotes: ['total_amount'],
  invoices: ['total_amount'],
  tickets: [],
  leads: ['score', 'value'],
};

/** Public dimension id → the column it actually lives in, where they differ. */
const GROUP_COLUMN_ALIAS: Record<string, string> = {
  size: 'company_size',
  type: 'event_type',
};

/** Thrown for a dimension the schema cannot answer, so POST can 400 it. */
export class UnresolvableDimensionError extends Error {}

/** Bad input the caller can fix, answered 400 instead of reaching Postgres. */
export class InvalidReportInputError extends Error {}

/**
 * A `dateRange` bound as a Date. `new Date('last tuesday')` is an object whose
 * getTime() is NaN, and binding it produced a driver-level error and a 500 for
 * what is a mistyped date in a UI field.
 */
function boundDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidReportInputError(`${field} is not a valid date: ${String(value).slice(0, 40)}`);
  }
  return parsed;
}

/**
 * Equality against the expression the chart groups on, so a filter value is a
 * label the caller can actually see. `stage` resolves to the stage's name and
 * `completed` to 'Completed'/'Pending' the same way the bars are labelled,
 * rather than to the uuid or the boolean behind them.
 */
function buildFilterConditions(entity: string, filters: Record<string, unknown>): import('drizzle-orm').SQL[] {
  const allowed = ALLOWED_GROUP_FIELDS[entity] ?? [];
  const conditions: import('drizzle-orm').SQL[] = [];
  for (const [field, raw] of Object.entries(filters ?? {})) {
    if (!allowed.includes(field)) {
      throw new UnresolvableDimensionError(
        `Invalid filter field '${field}' for ${entity}. Allowed: ${allowed.join(', ')}`,
      );
    }
    const values = (Array.isArray(raw) ? raw : [raw])
      .map(v => (v === null || v === undefined ? '' : String(v)))
      .filter(v => v !== '');
    if (values.length === 0) continue;
    const expr = resolveGroupExpression(entity, field);
    conditions.push(values.length === 1
      ? sql`(${expr}) = ${values[0]}`
      : sql`(${expr}) in (${sql.join(values.map(v => sql`${v}`), sql`, `)})`);
  }
  return conditions;
}

export function resolveGroupExpression(entity: string, groupBy: string): import('drizzle-orm').SQL {
  // Time-based grouping
  if (groupBy === 'created_at_month') return sql`TO_CHAR(created_at, 'YYYY-MM')`;
  if (groupBy === 'created_at_week') return sql`TO_CHAR(created_at, 'IYYY-IW')`;
  if (groupBy === 'close_date_month') return sql`TO_CHAR(close_date, 'YYYY-MM')`;

  // Boolean fields
  if (groupBy === 'completed') return sql`CASE WHEN completed THEN 'Completed' ELSE 'Pending' END`;

  // Deals store a stage_id uuid; grouping on it directly would label every bar
  // with an unparseable id, so resolve the stage's name instead. Correlated on
  // the outer FROM, which is always the entity's own table.
  if (entity === 'deals' && groupBy === 'stage') {
    return sql`COALESCE((SELECT ds.name FROM deal_stages ds WHERE ds.id = stage_id)::text, 'Unknown')`;
  }

  const column = GROUP_COLUMN_ALIAS[groupBy] ?? groupBy;
  return sql`COALESCE(${sql.identifier(column)}::text, 'Unknown')`;
}

async function executeReport(params: ReportParams): Promise<ReportResult> {
  const { entity, metric, metricField, groupBy, dateRange, filters, tenantId, limit } = params;

  // Validate groupBy field
  const allowedFields = ALLOWED_GROUP_FIELDS[entity] || [];
  if (!allowedFields.includes(groupBy)) {
    throw new UnresolvableDimensionError(
      `Invalid groupBy field '${groupBy}' for ${entity}. Allowed: ${allowedFields.join(', ')}`,
    );
  }

  // Validate metricField
  if (metricField) {
    const allowedMetrics = ALLOWED_METRIC_FIELDS[entity] || [];
    if (!allowedMetrics.includes(metricField)) {
      throw new UnresolvableDimensionError(
        `Invalid metricField '${metricField}' for ${entity}. Allowed: ${allowedMetrics.join(', ')}`,
      );
    }
  }

  const groupSql = resolveGroupExpression(entity, groupBy);
  const metricSql = buildMetricExpression(metric, metricField);

  // Build WHERE clause
  const tableMap: Record<string, string> = {
    contacts: 'contacts',
    deals: 'deals',
    tasks: 'tasks',
    companies: 'companies',
    activities: 'activities',
    quotes: 'quotes',
    invoices: 'invoices',
    tickets: 'support_tickets',
    leads: 'leads',
  };
  const tableName = tableMap[entity]!;

  const conditions: import('drizzle-orm').SQL[] = [];
  conditions.push(sql`${sql.identifier(tableName)}.tenant_id = ${tenantId}`);

  if (dateRange?.from) {
    conditions.push(sql`${sql.identifier(tableName)}.created_at >= ${boundDate(dateRange.from, 'dateRange.from')}`);
  }
  if (dateRange?.to) {
    conditions.push(sql`${sql.identifier(tableName)}.created_at <= ${boundDate(dateRange.to, 'dateRange.to')}`);
  }

  // `filters` was accepted by POST, forwarded here, and then never read: a
  // caller narrowing a report got the unfiltered numbers with no indication the
  // narrowing had been dropped.
  conditions.push(...buildFilterConditions(entity, filters));

  if (['contacts', 'deals', 'tasks', 'companies', 'activities', 'quotes', 'invoices', 'tickets', 'leads'].includes(entity)) {
    conditions.push(sql`${sql.identifier(tableName)}.deleted_at IS NULL`);
  }

  const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

  const { rows } = await db.execute(sql`
    SELECT
      ${groupSql} as label,
      ${metricSql} as value
    FROM ${sql.identifier(tableName)}
    ${whereClause}
    GROUP BY ${groupSql}
    ORDER BY value DESC
    LIMIT ${limit}
  `);

  // Calculate total and percentages
  const data = (rows as { label?: unknown; value?: unknown }[]).map(row => ({
    label: row.label?.toString() || 'Unknown',
    value: Number(row.value) || 0,
    percentage: 0,
  }));

  const total = data.reduce((sum, d) => sum + d.value, 0);

  // Calculate percentages
  if (total > 0) {
    for (const item of data) {
      item.percentage = Math.round((item.value / total) * 1000) / 10; // 1 decimal
    }
  }

  return { data, total };
}

function buildMetricExpression(metric: string, metricField?: string): import('drizzle-orm').SQL {
  switch (metric) {
    case 'count': return sql`COUNT(*)::int`;
    case 'sum': return sql`COALESCE(SUM(${sql.identifier(metricField ?? '')}::numeric), 0)::numeric`;
    case 'avg': return sql`COALESCE(ROUND(AVG(${sql.identifier(metricField ?? '')}::numeric), 2), 0)::numeric`;
    default: return sql`COUNT(*)::int`;
  }
}

/**
 * GET /api/tenant/reports/builder
 * Returns available report dimensions and metrics for the UI.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    return NextResponse.json({
      entities: [
        {
          id: 'contacts',
          label: 'Contacts',
          groupByOptions: [
            { id: 'lead_status', label: 'Lead Status' },
            { id: 'lead_source', label: 'Lead Source' },
            { id: 'created_at_month', label: 'Month Created' },
            { id: 'created_at_week', label: 'Week Created' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
            { id: 'avg', label: 'Avg Score', field: 'score' },
          ],
        },
        {
          id: 'deals',
          label: 'Deals',
          groupByOptions: [
            { id: 'stage', label: 'Stage' },
            { id: 'created_at_month', label: 'Month Created' },
            { id: 'close_date_month', label: 'Close Month' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
            { id: 'sum', label: 'Total Value', field: 'amount' },
            { id: 'avg', label: 'Avg Value', field: 'amount' },
          ],
        },
        {
          id: 'tasks',
          label: 'Tasks',
          groupByOptions: [
            { id: 'priority', label: 'Priority' },
            { id: 'completed', label: 'Status' },
            { id: 'created_at_month', label: 'Month Created' },
            { id: 'created_at_week', label: 'Week Created' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
          ],
        },
        {
          id: 'companies',
          label: 'Companies',
          groupByOptions: [
            { id: 'industry', label: 'Industry' },
            { id: 'size', label: 'Size' },
            { id: 'created_at_month', label: 'Month Created' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
          ],
        },
        {
          id: 'activities',
          label: 'Activities',
          groupByOptions: [
            { id: 'type', label: 'Type' },
            { id: 'created_at_month', label: 'Month' },
            { id: 'created_at_week', label: 'Week' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
          ],
        },
        {
          id: 'quotes',
          label: 'Quotes',
          groupByOptions: [
            { id: 'status', label: 'Status' },
            { id: 'created_at_month', label: 'Month' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
            { id: 'sum', label: 'Total Amount', field: 'total_amount' },
            { id: 'avg', label: 'Avg Amount', field: 'total_amount' },
          ],
        },
        {
          id: 'invoices',
          label: 'Invoices',
          groupByOptions: [
            { id: 'status', label: 'Status' },
            { id: 'created_at_month', label: 'Month' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
            { id: 'sum', label: 'Total Amount', field: 'total_amount' },
            { id: 'avg', label: 'Avg Amount', field: 'total_amount' },
          ],
        },
        {
          id: 'tickets',
          label: 'Tickets',
          groupByOptions: [
            { id: 'status', label: 'Status' },
            { id: 'priority', label: 'Priority' },
            { id: 'category', label: 'Category' },
            { id: 'created_at_month', label: 'Month' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
          ],
        },
        {
          id: 'leads',
          label: 'Leads',
          groupByOptions: [
            { id: 'lead_status', label: 'Lead Status' },
            { id: 'lead_source', label: 'Lead Source' },
            { id: 'created_at_month', label: 'Month' },
          ],
          metricOptions: [
            { id: 'count', label: 'Count' },
            { id: 'avg', label: 'Avg Score', field: 'score' },
          ],
        },
      ],
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});
