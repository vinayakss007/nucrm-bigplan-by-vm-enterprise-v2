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

export const GET = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const maxAgeParam = request.nextUrl.searchParams.get('maxAgeMs');
  const maxAgeMs = maxAgeParam ? Math.max(Number(maxAgeParam), 60_000) : 900_000;

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
