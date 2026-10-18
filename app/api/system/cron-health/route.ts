/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Cron Health Endpoint (Superadmin only)
 * GET /api/system/cron-health
 *
 * Returns the status of all registered cron jobs, including whether
 * any are stale (haven't fired within their expected interval).
 * Acts as a dead-man switch for background job monitoring.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getCronHealth, getStaleJobs } from '@/lib/cron/health';
import { withApiRoute } from '@/lib/api/with-api-route';
import { clampInt } from '@/lib/api/query-params';

export const GET = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const maxAgeParam = request.nextUrl.searchParams.get('maxAgeMs');
  // #2766 — `Math.max(Number('abc'), 60_000)` is `NaN`, and `lib/cron/health.ts:81`
  // computes `stale = now - record.lastRunAt > maxAgeMs`; every comparison against
  // `NaN` is false, so a typo in the query string made the endpoint answer
  // `{"status":"healthy"}` for a fleet whose cron had not run for a week. That is
  // worse than the 500 the other sites in this sweep cause: it is the monitor turning
  // itself off and reporting that it is on. The `max` stays open-ended because no
  // ceiling on how stale a caller may ask about is this route's policy to invent.
  const maxAgeMs = clampInt(maxAgeParam, 900_000, 60_000, Number.MAX_SAFE_INTEGER);

  const jobs = getCronHealth(maxAgeMs);
  const staleJobs = getStaleJobs(maxAgeMs);

  return NextResponse.json({
    status: staleJobs.length === 0 ? 'healthy' : 'degraded',
    totalJobs: jobs.length,
    staleCount: staleJobs.length,
    jobs,
    staleJobs: staleJobs.map(j => j.jobName),
    checkedAt: new Date().toISOString(),
  });
});
