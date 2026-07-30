import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { getMetrics } from '@/lib/metrics';

/**
 * GET /api/tenant/reports/api-usage
 * API usage metrics — current request counts, rate limit status, top endpoints.
 *
 * Pulls from the in-memory metrics collector (lib/metrics.ts).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const metrics = getMetrics();

    // Filter to this tenant's requests (if metrics track tenantId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantMetrics = metrics.requests?.filter((r: any) => r.tenantId === ctx.tenantId) || [];

    // Compute stats
    const totalRequests = tenantMetrics.length;
    const last24h = tenantMetrics.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => new Date(r.timestamp).getTime() > Date.now() - 24 * 60 * 60 * 1000
    );

    // Top endpoints
    const endpointCounts = new Map<string, number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of last24h as any[]) {
      const path = r.path || r.url || 'unknown';
      endpointCounts.set(path, (endpointCounts.get(path) || 0) + 1);
    }

    const topEndpoints = [...endpointCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    // Error rate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors = last24h.filter((r: any) => (r.status ?? 0) >= 400);

    // Plan limits (from context)
    const planLimits: Record<string, number> = {
      free: 1000,
      starter: 5000,
      pro: 50000,
      enterprise: 500000,
    };
    const limit = planLimits[ctx.plan?.name ?? 'free'] || 1000;

    return NextResponse.json({
      data: {
        total_requests_24h: last24h.length,
        total_requests_all_time: totalRequests,
        error_count_24h: errors.length,
        error_rate_pct: last24h.length > 0 ? Math.round((errors.length / last24h.length) * 100) : 0,
        top_endpoints: topEndpoints,
        plan_limit_daily: limit,
        usage_pct: limit > 0 ? Math.round((last24h.length / limit) * 100) : 0,
        timestamp: new Date().toISOString(),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
