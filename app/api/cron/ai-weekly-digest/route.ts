/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { verifyCronSecret } from '@/lib/auth/cron';
import { logError } from '@/lib/errors-server';
import { instrumentCronRun, refuseIfCronLockHeld } from '@/lib/cron/cron-lock';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { aiActivity } from '@/drizzle/schema/ai';
import { aiInsights } from '@/drizzle/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { chat, GatewayError } from '@/lib/ai/gateway';
import { createNotification } from '@/lib/notifications';
import { apiError } from '@/lib/api-error';
import { apiFail } from '@/lib/api/api-envelope';
import { sweepTenants } from '@/lib/cron/tenant-scope';

const WINDOW_DAYS = 7;
const LOCK_SECONDS = 7 * 24 * 60 * 60;

export type DigestStats = { runs: number; insights: number; successes: number };

export function digestFallback(stats: DigestStats): string {
  return `Your workspace ran ${stats.runs} AI action(s) in the last ${WINDOW_DAYS} days, produced ${stats.insights} saved insight(s), and ${stats.successes} completed successfully. Open the AI Hub to review the activity log and results.`;
}

async function cronRouteHandler(request: NextRequest) {
  if (!await verifyCronSecret(request, { job: 'ai-weekly-digest' })) {
    return NextResponse.json(apiFail('UNAUTHORIZED', 'Unauthorized'), { status: 401 });
  }

  const refusal = await refuseIfCronLockHeld('cron:ai-weekly-digest', LOCK_SECONDS);
  if (refusal) return refusal;

  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    let tenantsWithActivity = 0;
    let notificationsSent = 0;

    const sweep = await sweepTenants('cron/ai-weekly-digest', async (tenantId) => {
      const [[runRow], [insightRow], actingResult] = await Promise.all([
        db.select({
          runs: sql<number>`count(*)::int`,
          successes: sql<number>`count(*) FILTER (WHERE ${aiActivity.status} = 'success')::int`,
        }).from(aiActivity).where(and(eq(aiActivity.tenantId, tenantId), gte(aiActivity.createdAt, since))),
        db.select({ count: sql<number>`count(*)::int` })
          .from(aiInsights).where(and(eq(aiInsights.tenantId, tenantId), gte(aiInsights.createdAt, since))),
        db.execute(sql`SELECT current_setting('app.current_user', true) AS user_id`),
      ]);

      const stats: DigestStats = {
        runs: runRow?.runs ?? 0,
        successes: runRow?.successes ?? 0,
        insights: insightRow?.count ?? 0,
      };
      if (stats.runs === 0 && stats.insights === 0) return;

      const rows = Array.isArray(actingResult)
        ? actingResult
        : (actingResult as { rows?: { user_id?: string }[] }).rows ?? [];
      const userId = rows[0]?.user_id;
      if (!userId) return;

      let body = digestFallback(stats);
      try {
        const resp = await chat({
          tenantId,
          userId,
          action: 'summarize',
          system: 'Write a two-sentence, plain-language summary of a CRM workspace\'s AI usage over the past week. Use only the numbers given. No preamble, no markdown.',
          messages: [{ role: 'user', content: JSON.stringify(stats) }],
          metadata: { feature: 'weekly_ai_digest' },
        });
        if (resp.text.trim()) body = resp.text.trim().slice(0, 1000);
      } catch (err) {
        if (!(err instanceof GatewayError)) throw err;
      }

      const stored = await createNotification({
        userId,
        tenantId,
        type: 'system',
        title: 'Your weekly AI digest',
        body,
        link: '/tenant/ai',
      });
      if (!stored) throw new Error('weekly AI digest notification was not persisted');
      tenantsWithActivity++;
      notificationsSent++;
    });

    return NextResponse.json({
      ok: true,
      tenants_visited: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenant_failures: sweep.failed.length,
      tenants_with_activity: tenantsWithActivity,
      notifications_sent: notificationsSent,
    });
  } catch (error) {
    void logError({ error, context: 'cron/ai-weekly-digest' });
    return apiError(error);
  }
}

export const POST = instrumentCronRun('ai-weekly-digest', cronRouteHandler);
