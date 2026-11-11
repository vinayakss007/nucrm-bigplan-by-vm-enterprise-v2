/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Cron Health Endpoint (Superadmin only)
 * GET /api/system/cron-health
 *
 * #3410: the verdict is now the MANIFEST compared against the durable
 * `cron_runs` ledger, not the answering process's memory. Every scheduled
 * job in lib/cron/jobs.ts is collapsed against its last attempt and last
 * success; a job with no row is `never_run` — reported as loudly as `stale`,
 * and either one makes the overall status `fail`. A job that runs nowhere
 * (the tracked #2539 step-3 orphans) reads `unscheduled` and caps the
 * verdict at `degraded`.
 *
 * The legacy in-memory registry (lib/cron/health.ts top half) is still
 * served under `processRegistry` for whoever was reading it before — it is
 * now genuinely written by instrumentCronRun, but it remains per-process.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';
import { summarizeCronHealth, getCronHealth, getStaleJobs, type CronJobRunSummary } from '@/lib/cron/health';
import { withApiRoute } from '@/lib/api/with-api-route';
import { clampInt } from '@/lib/api/query-params';
import { db } from '@/drizzle/db';

export const GET = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const maxAgeParam = request.nextUrl.searchParams.get('maxAgeMs');
  // #2766 — `Math.max(Number('abc'), 60_000)` is `NaN`, and every comparison
  // against `NaN` is false: the monitor used to turn itself off and report
  // that it was watching. clampInt answers junk with the DEFAULT; the default
  // here is 0 slack, i.e. "use the manifest's own expectedEveryMs", and the
  // parameter can only ever TOLERATE more lateness, never mask a never_run.
  const maxAgeSlackMs = clampInt(maxAgeParam, 0, 0, Number.MAX_SAFE_INTEGER);

  // Two collapsed reads (cron_rows are append-only and pruned by the cleanup
  // cron). FORCE RLS on cron_runs gates reads behind app.is_super_admin, which
  // requireAuth() has just set session-scoped on this connection.
  const [lastAttempt, lastSuccess] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (job) job,
                              EXTRACT(EPOCH FROM started_at) * 1000 AS "lastRunAtMs",
                              ok AS "lastRunOk",
                              error AS "lastRunError"
      FROM cron_runs
      ORDER BY job, started_at DESC
    `),
    db.execute(sql`
      SELECT job, MAX(EXTRACT(EPOCH FROM started_at) * 1000) AS "lastSuccessAtMs"
      FROM cron_runs
      WHERE ok
      GROUP BY job
    `),
  ]);

  const successByJob = new Map<string, number | null>(
    ((lastSuccess.rows ?? []) as Array<{ job: string; lastSuccessAtMs: string | number | null }>).map((r) => [
      r.job,
      r.lastSuccessAtMs == null ? null : Number(r.lastSuccessAtMs),
    ]),
  );
  const rows: CronJobRunSummary[] = ((lastAttempt.rows ?? []) as Array<{
    job: string;
    lastRunAtMs: string | number;
    lastRunOk: boolean;
    lastRunError: string | null;
  }>).map((r) => ({
    job: r.job,
    lastRunAtMs: Number(r.lastRunAtMs),
    lastRunOk: r.lastRunOk,
    lastRunError: r.lastRunError,
    lastSuccessAtMs: successByJob.get(r.job) ?? null,
  }));

  const report = summarizeCronHealth(rows, Date.now(), maxAgeSlackMs);

  return NextResponse.json({
    status: report.status,
    totalJobs: report.jobs.length,
    staleCount: report.stale.length + report.neverRun.length,
    jobs: report.jobs,
    neverRun: report.neverRun,
    staleJobs: report.stale,
    unscheduled: report.unscheduled,
    counts: report.counts,
    processRegistry: getCronHealth(900_000),
    processStaleJobs: getStaleJobs(900_000).map((j) => j.jobName),
    checkedAt: new Date().toISOString(),
  });
});
