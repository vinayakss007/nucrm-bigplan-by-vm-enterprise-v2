import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

/**
 * GET /api/tenant/reports/sla-compliance
 * SLA compliance metrics — how well the team meets response/follow-up deadlines.
 *
 * Returns:
 * - follow_up_compliance: % of follow-ups completed before due date
 * - task_completion_rate: % of tasks completed on time
 * - overdue_follow_ups: count currently overdue
 * - overdue_tasks: count currently overdue
 * - avg_response_time_hours: average time between follow-up creation and completion
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const tid = ctx.tenantId;

    // Follow-up SLA: completed before due date
    const fuStatsResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at <= due_date) as on_time,
        COUNT(*) FILTER (WHERE status = 'completed') as total_completed,
        COUNT(*) FILTER (WHERE status != 'completed' AND due_date < NOW()) as overdue
      FROM follow_ups
      WHERE tenant_id = ${tid} AND deleted_at IS NULL
    `);

    // Task SLA: completed before due date
    const taskStatsResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL AND due_date IS NOT NULL AND completed_at <= due_date) as on_time,
        COUNT(*) FILTER (WHERE status = 'completed') as total_completed,
        COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled') AND due_date IS NOT NULL AND due_date < NOW()) as overdue
      FROM tasks
      WHERE tenant_id = ${tid} AND deleted_at IS NULL
    `);

    // Average response time (follow-up creation → completion)
    const avgResponseResult = await db.execute(sql`
      SELECT
        COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600), 0)::numeric(10,1) as avg_hours
      FROM follow_ups
      WHERE tenant_id = ${tid}
        AND deleted_at IS NULL
        AND status = 'completed'
        AND completed_at IS NOT NULL
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fu = fuStatsResult.rows[0] as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ts = taskStatsResult.rows[0] as any;

    const fuOnTime = Number(fu?.on_time ?? 0);
    const fuTotal = Number(fu?.total_completed ?? 1);
    const taskOnTime = Number(ts?.on_time ?? 0);
    const taskTotal = Number(ts?.total_completed ?? 1);

    return NextResponse.json({
      data: {
        follow_up_compliance_pct: fuTotal > 0 ? Math.round((fuOnTime / fuTotal) * 100) : 100,
        task_completion_pct: taskTotal > 0 ? Math.round((taskOnTime / taskTotal) * 100) : 100,
        overdue_follow_ups: Number(fu?.overdue ?? 0),
        overdue_tasks: Number(ts?.overdue ?? 0),
        avg_response_time_hours: Number((avgResponseResult.rows[0] as { avg_hours: string })?.avg_hours ?? 0),
        follow_ups_completed: fuTotal,
        tasks_completed: taskTotal,
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
