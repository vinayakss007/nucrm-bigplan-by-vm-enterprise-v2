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
import { eq, and, desc, sql, gt, lt, type SQL } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

type ReportColumn = string | SQL;

interface ReportConfig {
  table: AnyPgTable & {
    tenantId: Column;
    createdAt: Column;
    deletedAt?: Column;
    status?: Column;
    stage?: Column;
    leadStatus?: Column;
  };
  columns: ReportColumn[];
  joins?: { table: AnyPgTable; field: string; as: string; select: Column | SQL }[];
  groupBy?: string;
  filters?: { field: string; value: string }[];
}

const REPORT_QUERIES: Record<string, ReportConfig> = {
  contacts: {
    table: contacts,
    columns: ['first_name', 'last_name', 'email', 'phone', 'company_id', 'lead_status', 'lifecycle_stage', 'score', 'created_at'],
    joins: [{ table: companies, field: 'companyId', as: 'company_name', select: companies.name }],
  },
  companies: {
    table: companies,
    columns: ['name', 'industry', 'website', 'phone', 'address', 'employee_count', 'annual_revenue', 'created_at'],
  },
  deals: {
    table: deals,
    columns: ['title', 'value', 'stage', 'probability', 'close_date', 'contact_id', 'created_at'],
    joins: [{ table: contacts, field: 'contactId', as: 'contact_name', select: sql`concat(${contacts.firstName}, ' ', ${contacts.lastName})` }],
  },
  tasks: {
    table: tasks,
    columns: ['title', 'description', 'priority', 'status', 'due_date', 'completed_at', 'contact_id', 'created_at'],
  },
  leads: {
    table: leads,
    columns: ['first_name', 'last_name', 'email', 'phone', 'status', 'source', 'score', 'created_at'],
  },
  pipeline: {
    table: deals,
    columns: ['stage', sql`count(*)::int as count`, sql`sum(value::numeric)::numeric as total_value`],
    groupBy: 'stage',
  },
  revenue: {
    table: deals,
    columns: ['stage', sql`count(*)::int as count`, sql`sum(value::numeric)::numeric as revenue`],
    groupBy: 'stage',
    filters: [{ field: 'stage', value: 'won' }],
  },
};

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { report_type, filters, limit = 100 } = await readJsonBody(request);

    const reportConfig = REPORT_QUERIES[report_type];
    if (!reportConfig) {
      return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
    }

    // The whole registry is dynamic (tables and columns come from config
    // literals above), so the drizzle selection map and groupBy argument are
    // reinterpreted through casts — the runtime values are unchanged.
    const table = reportConfig.table;
    const selection = (reportConfig.columns || {}) as unknown as Record<string, SQL>;

    const conditions: SQL[] = [eq(table.tenantId, ctx.tenantId)];

    const deletedAt = table.deletedAt;
    if (deletedAt) {
      conditions.push(sql`${deletedAt} IS NULL`);
    }

    if (filters) {
      const status = table.status;
      if (filters.status && status) {
        conditions.push(eq(status, filters.status));
      }
      const stage = table.stage;
      if (filters.stage && stage) {
        conditions.push(eq(stage, filters.stage));
      }
      const leadStatus = table.leadStatus;
      if (filters.lead_status && leadStatus) {
        conditions.push(eq(leadStatus, filters.lead_status));
      }
      if (filters.created_after) {
        conditions.push(gt(table.createdAt, new Date(filters.created_after)));
      }
      if (filters.created_before) {
        conditions.push(lt(table.createdAt, new Date(filters.created_before)));
      }
    }

    const rows: unknown[] = reportConfig.groupBy
      ? await db
          .select(selection)
          .from(table)
          .where(and(...conditions))
          .groupBy(reportConfig.columns[0] as unknown as SQL)
      : await db
          .select(selection)
          .from(table)
          .where(and(...conditions))
          .orderBy(desc(table.createdAt))
          .limit(limit);

    return NextResponse.json({
      data: rows,
      meta: {
        count: rows.length,
        report_type,
        generated_at: new Date().toISOString(),
      },
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'report run POST', requestMethod: 'POST' });
    return apiError(err);
  }
});