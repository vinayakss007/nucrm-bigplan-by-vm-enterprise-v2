import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, tasks, companies, activities } from '@/drizzle/schema';
import { eq, and, sql, gte, lte, count, sum, avg } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Custom Report Builder API
 *
 * Deterministic aggregation engine — NO AI.
 * Accepts a report definition and returns chart-ready data.
 *
 * POST /api/tenant/reports/builder
 *
 * Body: {
 *   entity: 'contacts' | 'deals' | 'tasks' | 'companies' | 'activities',
 *   metric: 'count' | 'sum' | 'avg',
 *   metricField?: string,           // Required for sum/avg (e.g., 'value' for deals)
 *   groupBy: string,                // Field to group by (e.g., 'lead_status', 'stage', 'priority')
 *   dateRange?: { from: string, to: string },
 *   filters?: Record<string, string | string[]>,
 *   limit?: number,                 // Max groups to return (default 20)
 * }
 *
 * Returns: {
 *   data: Array<{ label: string, value: number, percentage?: number }>,
 *   total: number,
 *   meta: { entity, metric, groupBy, dateRange, generatedAt }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await checkRateLimit(request, { action: 'report-builder', max: 20, windowMinutes: 1 });
    if (limited) return limited;

    const body = await request.json();
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
    const validEntities = ['contacts', 'deals', 'tasks', 'companies', 'activities'];
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
  } catch (err: any) {
    return apiError(err);
  }
}

// ── Report Execution Engine ──────────────────────────────────────────────────

interface ReportParams {
  entity: string;
  metric: string;
  metricField?: string;
  groupBy: string;
  dateRange?: { from: string; to: string };
  filters: Record<string, any>;
  tenantId: string;
  limit: number;
}

interface ReportResult {
  data: Array<{ label: string; value: number; percentage: number }>;
  total: number;
}

// Allowed group-by fields per entity (whitelist to prevent SQL injection)
const ALLOWED_GROUP_FIELDS: Record<string, string[]> = {
  contacts: ['lead_status', 'lead_source', 'created_at_month', 'created_at_week', 'company_id'],
  deals: ['stage', 'created_at_month', 'created_at_week', 'close_date_month', 'assigned_to'],
  tasks: ['priority', 'completed', 'created_at_month', 'created_at_week', 'assigned_to'],
  companies: ['industry', 'size', 'created_at_month'],
  activities: ['type', 'created_at_month', 'created_at_week', 'user_id'],
};

// Allowed metric fields per entity
const ALLOWED_METRIC_FIELDS: Record<string, string[]> = {
  contacts: ['score'],
  deals: ['value', 'probability'],
  tasks: [],
  companies: [],
  activities: [],
};

async function executeReport(params: ReportParams): Promise<ReportResult> {
  const { entity, metric, metricField, groupBy, dateRange, tenantId, limit } = params;

  // Validate groupBy field
  const allowedFields = ALLOWED_GROUP_FIELDS[entity] || [];
  if (!allowedFields.includes(groupBy)) {
    throw new Error(`Invalid groupBy field '${groupBy}' for ${entity}. Allowed: ${allowedFields.join(', ')}`);
  }

  // Validate metricField
  if (metricField) {
    const allowedMetrics = ALLOWED_METRIC_FIELDS[entity] || [];
    if (!allowedMetrics.includes(metricField)) {
      throw new Error(`Invalid metricField '${metricField}' for ${entity}. Allowed: ${allowedMetrics.join(', ')}`);
    }
  }

  // Build the SQL group expression
  const groupExpr = buildGroupExpression(groupBy);
  const metricExpr = buildMetricExpression(metric, metricField);

  // Build WHERE clause
  const tableMap: Record<string, string> = {
    contacts: 'contacts',
    deals: 'deals',
    tasks: 'tasks',
    companies: 'companies',
    activities: 'activities',
  };
  const tableName = tableMap[entity]!;

  let dateFilter = '';
  const queryParams: any[] = [tenantId];
  let paramIndex = 2;

  if (dateRange?.from) {
    dateFilter += ` AND created_at >= $${paramIndex}`;
    queryParams.push(new Date(dateRange.from));
    paramIndex++;
  }
  if (dateRange?.to) {
    dateFilter += ` AND created_at <= $${paramIndex}`;
    queryParams.push(new Date(dateRange.to));
    paramIndex++;
  }

  // Add soft-delete filter for applicable entities
  const softDeleteFilter = ['contacts', 'deals'].includes(entity) ? ' AND deleted_at IS NULL' : '';

  const query = `
    SELECT 
      ${groupExpr} as label,
      ${metricExpr} as value
    FROM ${tableName}
    WHERE tenant_id = $1 ${dateFilter} ${softDeleteFilter}
    GROUP BY ${groupExpr}
    ORDER BY value DESC
    LIMIT ${limit}
  `;

  const { rows } = await db.execute(sql.raw(buildParameterizedQuery(query, queryParams)));

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

function buildGroupExpression(groupBy: string): string {
  // Time-based grouping
  if (groupBy === 'created_at_month') return "TO_CHAR(created_at, 'YYYY-MM')";
  if (groupBy === 'created_at_week') return "TO_CHAR(created_at, 'IYYY-IW')";
  if (groupBy === 'close_date_month') return "TO_CHAR(close_date, 'YYYY-MM')";

  // Boolean fields
  if (groupBy === 'completed') return "CASE WHEN completed THEN 'Completed' ELSE 'Pending' END";

  // Direct column reference (already validated against whitelist)
  return `COALESCE(${groupBy}::text, 'Unknown')`;
}

function buildMetricExpression(metric: string, metricField?: string): string {
  switch (metric) {
    case 'count': return 'COUNT(*)::int';
    case 'sum': return `COALESCE(SUM(${metricField}::numeric), 0)::numeric`;
    case 'avg': return `COALESCE(ROUND(AVG(${metricField}::numeric), 2), 0)::numeric`;
    default: return 'COUNT(*)::int';
  }
}

function buildParameterizedQuery(query: string, params: any[]): string {
  // For raw SQL execution with drizzle, we need to inline the parameters safely
  // This is acceptable because all field names are whitelist-validated above
  let result = query;
  for (let i = params.length; i >= 1; i--) {
    const value = params[i - 1];
    if (value instanceof Date) {
      result = result.replace(`$${i}`, `'${value.toISOString()}'`);
    } else if (typeof value === 'string') {
      // Escape single quotes
      result = result.replace(`$${i}`, `'${value.replace(/'/g, "''")}'`);
    } else {
      result = result.replace(`$${i}`, String(value));
    }
  }
  return result;
}

/**
 * GET /api/tenant/reports/builder
 * Returns available report dimensions and metrics for the UI.
 */
export async function GET(request: NextRequest) {
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
            { id: 'sum', label: 'Total Value', field: 'value' },
            { id: 'avg', label: 'Avg Value', field: 'value' },
            { id: 'avg', label: 'Avg Probability', field: 'probability' },
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
      ],
    });
  } catch (err: any) {
    return apiError(err);
  }
}
