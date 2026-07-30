import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { metrics } from '@/lib/metrics';

/**
 * GET /api/tenant/reports/api-usage
 *
 * API request metrics from the in-memory collector in lib/metrics.ts.
 *
 * Superadmin only, and deliberately so. The collector is a process-wide ring
 * buffer (MAX_METRICS = 10_000) and trackRequest() records only
 * { method, path, status } — there is no tenant label on any HTTP metric. So
 * these numbers cannot be attributed to a single tenant. Returning them from a
 * tenant-facing endpoint would both report wrong totals and expose the request
 * paths of every other tenant on the instance.
 *
 * Two further caveats worth knowing before trusting these numbers:
 *  - the buffer is per-process, so with several `web` replicas each returns only
 *    its own slice;
 *  - it is in-memory, so it resets on deploy and is not a billing source.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Super admin required: API metrics are process-wide, not per-tenant.' },
        { status: 403 }
      );
    }

    const points = metrics.getMetrics();
    const since = Date.now() - 24 * 60 * 60 * 1000;

    const requests = points.filter((p) => p.name === 'http_requests_total');
    const requests24h = requests.filter((p) => p.timestamp > since);

    /** Sum `value` rather than counting points: increment() may batch. */
    const sum = (pts: typeof points) => pts.reduce((n, p) => n + (p.value || 0), 0);

    const endpointCounts = new Map<string, number>();
    for (const p of requests24h) {
      const path = p.labels?.['path'] ?? 'unknown';
      endpointCounts.set(path, (endpointCounts.get(path) ?? 0) + (p.value || 0));
    }

    const topEndpoints = [...endpointCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    // Status is a label on http_requests_total; http_errors_total only covers
    // 5xx, so 4xx would be missed if we used that metric instead.
    const errors24h = requests24h.filter((p) => Number(p.labels?.['status'] ?? 0) >= 400);

    const total24h = sum(requests24h);
    const errorCount = sum(errors24h);

    return NextResponse.json({
      data: {
        scope: 'process',
        total_requests_24h: total24h,
        total_requests_buffered: sum(requests),
        error_count_24h: errorCount,
        error_rate_pct: total24h > 0 ? Math.round((errorCount / total24h) * 100) : 0,
        top_endpoints: topEndpoints,
        buffered_metric_points: points.length,
        timestamp: new Date().toISOString(),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
