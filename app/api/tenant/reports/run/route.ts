import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, tasks, leads } from '@/drizzle/schema';
import { eq, and, desc, sql, gt, lt } from 'drizzle-orm';

const REPORT_QUERIES: Record<string, any> = {
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

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { report_type, filters, limit = 100 } = await request.json();

    const reportConfig = REPORT_QUERIES[report_type];
    if (!reportConfig) {
      return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
    }

    let query = db.select(reportConfig.columns || {}).from(reportConfig.table);

    const conditions = [eq(reportConfig.table.tenantId, ctx.tenantId)];

    if (reportConfig.table !== deals && 'deletedAt' in reportConfig.table) {
      conditions.push(sql`${reportConfig.table.deletedAt} IS NULL`);
    }

    if (filters) {
      if (filters.status && 'status' in reportConfig.table) {
        conditions.push(eq(reportConfig.table.status, filters.status) as never);
      }
      if (filters.stage && 'stage' in reportConfig.table) {
        conditions.push(eq(reportConfig.table.stage, filters.stage) as never);
      }
      if (filters.lead_status && 'leadStatus' in reportConfig.table) {
        conditions.push(eq(reportConfig.table.leadStatus, filters.lead_status) as never);
      }
      if (filters.created_after) {
        conditions.push(gt(reportConfig.table.createdAt, new Date(filters.created_after)));
      }
      if (filters.created_before) {
        conditions.push(lt(reportConfig.table.createdAt, new Date(filters.created_before)));
      }
    }

    if (reportConfig.groupBy) {
      query = db
        .select(reportConfig.columns)
        .from(reportConfig.table)
        .where(and(...conditions))
        .groupBy(reportConfig.columns[0]) as any;
    } else {
      query = query.where(and(...conditions)).orderBy(desc(reportConfig.table.createdAt)).limit(limit) as any;
    }

    const results = await query as any[];

    return NextResponse.json({
      data: results,
      meta: {
        count: results.length,
        report_type,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[report run POST]', err);
    return apiError(err);
  }
}