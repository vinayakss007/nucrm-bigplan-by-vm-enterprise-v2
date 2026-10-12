/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

type Metric = 'deals_won' | 'revenue' | 'activities' | 'conversion';
type Period = 'week' | 'month' | 'quarter' | 'custom';

/**
 * #2388 — every metric below was written against a `deals` shape the schema has
 * never had: `owner_id`, `stage`, `closed_at`, `value`. The real columns are
 * `assigned_to`, `stage_id` (a uuid — "won" is a row in `deal_stages`, not a
 * string on the deal), `close_date` and `amount`. So all three deal metrics
 * failed with Postgres 42703 on every request, and the blanket `catch` that used
 * to wrap this switch swallowed it into `data = []`: a 200 with an empty board,
 * forever, with nothing logged.
 *
 * `won_at` is the win signal (`drizzle/schema/crm.ts:335-337` — a first-class
 * column precisely so reporting can filter wins without joining `deal_stages`),
 * and `amount` is the money column.
 */

/**
 * Members who still count. `tenant_members.status` is how removal is recorded
 * (`app/api/tenant/members/route.ts:273` writes `status: 'removed'`) and the
 * table also carries `deleted_at`; the two other membership readers already
 * filter both (`app/api/tenant/deals/import/route.ts:183`,
 * `app/api/cron/auto-backup/route.ts:229-233`). Without this an offboarded
 * teammate keeps a leaderboard row under their full name.
 */
function activeMemberIds(tenantId: string) {
  return sql`SELECT tm.user_id FROM tenant_members tm
               WHERE tm.tenant_id = ${tenantId}
                 AND tm.status = 'active'
                 AND tm.deleted_at IS NULL`;
}

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

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'analytics-pro', ctx.isSuperAdmin);
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
            LEFT JOIN deals d ON d.assigned_to = u.id 
              AND d.won_at IS NOT NULL
              AND d.won_at >= ${startDate}
              AND d.won_at <= ${endDate}
              AND d.tenant_id = ${ctx.tenantId}
              AND d.deleted_at IS NULL
            WHERE u.id IN (${activeMemberIds(ctx.tenantId)})
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
              COALESCE(SUM(d.amount), 0)::numeric as value
            FROM users u
            LEFT JOIN deals d ON d.assigned_to = u.id 
              AND d.won_at IS NOT NULL
              AND d.won_at >= ${startDate}
              AND d.won_at <= ${endDate}
              AND d.tenant_id = ${ctx.tenantId}
              AND d.deleted_at IS NULL
            WHERE u.id IN (${activeMemberIds(ctx.tenantId)})
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
              AND a.deleted_at IS NULL
            WHERE u.id IN (${activeMemberIds(ctx.tenantId)})
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
                ELSE (COUNT(CASE WHEN d.won_at IS NOT NULL THEN 1 END) * 100 / COUNT(d.id))::int
              END as value
            FROM users u
            LEFT JOIN deals d ON d.assigned_to = u.id
              AND d.created_at >= ${startDate}
              AND d.created_at <= ${endDate}
              AND d.tenant_id = ${ctx.tenantId}
              AND d.deleted_at IS NULL
            WHERE u.id IN (${activeMemberIds(ctx.tenantId)})
            GROUP BY u.id, u.full_name, u.email
            ORDER BY value DESC
            LIMIT 50
          `) as unknown as Array<{ userId: string; name: string; value: number }>;
          break;
      }
    } catch (err) {
      // #2388: this used to be `catch { data = [] }` — no binding, no log, no
      // rethrow. That is how four queries naming columns that have never existed
      // served an empty board for the life of the product: 42703 was
      // indistinguishable from "nobody won anything this month". The outer
      // `catch (err) { return apiError(err) }` already answers 500 and records
      // the failure, which is the only honest behaviour for a broken aggregate.
      void logError({ error: err, context: 'tenant/leaderboards', metadata: { metric, period } });
      throw err;
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
 
 
  } catch (err) {
    return apiError(err);
  }
});
