import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

type Metric = 'deals_won' | 'revenue' | 'activities' | 'conversion';
type Period = 'week' | 'month' | 'quarter' | 'custom';

function getDateRange(period: Period, start?: string, end?: string): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = end ? new Date(end) : now;
  let startDate: Date;

  switch (period) {
    case 'week': {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      break;
    }
    case 'month': {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      startDate = new Date(now.getFullYear(), qMonth, 1);
      break;
    }
    case 'custom': {
      startDate = start ? new Date(start) : new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { startDate, endDate };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'analytics-pro');
    if (moduleGate) return moduleGate;

    const { searchParams } = new URL(req.url);
    const metric = (searchParams.get('metric') || 'deals_won') as Metric;
    const period = (searchParams.get('period') || 'month') as Period;
    const start = searchParams.get('start') || undefined;
    const end = searchParams.get('end') || undefined;

    const { startDate, endDate } = getDateRange(period, start, end);

    // Build aggregation query based on metric
    let data: Array<{ userId: string; name: string; value: number }> = [];

    try {
      switch (metric) {
        case 'deals_won':
          data = await db.execute(sql`
            SELECT 
              u.id as "userId",
              COALESCE(u.full_name, u.email) as name,
              COUNT(d.id)::int as value
            FROM users u
            LEFT JOIN deals d ON d.owner_id = u.id 
              AND d.stage = 'won'
              AND d.closed_at >= ${startDate}
              AND d.closed_at <= ${endDate}
              AND d.tenant_id = ${ctx.tenantId}
            WHERE u.id IN (SELECT user_id FROM tenant_members WHERE tenant_id = ${ctx.tenantId})
            GROUP BY u.id, u.full_name, u.email
            ORDER BY value DESC
            LIMIT 50
          `) as unknown as Array<{ userId: string; name: string; value: number }>;
          break;
        case 'revenue':
          data = await db.execute(sql`
            SELECT 
              u.id as "userId",
              COALESCE(u.full_name, u.email) as name,
              COALESCE(SUM(d.value), 0)::int as value
            FROM users u
            LEFT JOIN deals d ON d.owner_id = u.id 
              AND d.stage = 'won'
              AND d.closed_at >= ${startDate}
              AND d.closed_at <= ${endDate}
              AND d.tenant_id = ${ctx.tenantId}
            WHERE u.id IN (SELECT user_id FROM tenant_members WHERE tenant_id = ${ctx.tenantId})
            GROUP BY u.id, u.full_name, u.email
            ORDER BY value DESC
            LIMIT 50
          `) as unknown as Array<{ userId: string; name: string; value: number }>;
          break;
        case 'activities':
          data = await db.execute(sql`
            SELECT 
              u.id as "userId",
              COALESCE(u.full_name, u.email) as name,
              COUNT(a.id)::int as value
            FROM users u
            LEFT JOIN activities a ON a.user_id = u.id
              AND a.created_at >= ${startDate}
              AND a.created_at <= ${endDate}
              AND a.tenant_id = ${ctx.tenantId}
            WHERE u.id IN (SELECT user_id FROM tenant_members WHERE tenant_id = ${ctx.tenantId})
            GROUP BY u.id, u.full_name, u.email
            ORDER BY value DESC
            LIMIT 50
          `) as unknown as Array<{ userId: string; name: string; value: number }>;
          break;
        case 'conversion':
          data = await db.execute(sql`
            SELECT 
              u.id as "userId",
              COALESCE(u.full_name, u.email) as name,
              CASE 
                WHEN COUNT(d.id) = 0 THEN 0
                ELSE (COUNT(CASE WHEN d.stage = 'won' THEN 1 END) * 100 / COUNT(d.id))::int
              END as value
            FROM users u
            LEFT JOIN deals d ON d.owner_id = u.id
              AND d.created_at >= ${startDate}
              AND d.created_at <= ${endDate}
              AND d.tenant_id = ${ctx.tenantId}
            WHERE u.id IN (SELECT user_id FROM tenant_members WHERE tenant_id = ${ctx.tenantId})
            GROUP BY u.id, u.full_name, u.email
            ORDER BY value DESC
            LIMIT 50
          `) as unknown as Array<{ userId: string; name: string; value: number }>;
          break;
      }
    } catch {
      // DB may not have these tables in dev/test - return empty
      data = [];
    }

    // Add rank
    const ranked = (Array.isArray(data) ? data : []).map((item: { userId: string; name: string; value: number }, idx: number) => ({
      userId: item.userId,
      name: item.name,
      value: Number(item.value) || 0,
      rank: idx + 1,
    }));

    return NextResponse.json({
      data: ranked,
      metric,
      period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
  } catch (err: any) {
    return apiError(err);
  }
}
