import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import * as dlq from '@/lib/webhooks/dlq';

/**
 * GET /api/tenant/webhooks/dlq — List dead letter queue entries
 * Query params: limit, offset, status
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));
    const status = searchParams.get('status') || undefined;

    const { entries, total } = await dlq.listDLQEntries(ctx.tenantId, { limit, offset, status });
    const stats = await dlq.getDLQStats(ctx.tenantId);

    return NextResponse.json({
      data: entries,
      total,
      limit,
      offset,
      hasMore: offset + entries.length < total,
      stats,
    });
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/webhooks/dlq — Retry or purge DLQ entries
 * Body: { action: 'retry' | 'retry_all' | 'purge' | 'purge_old', ids?: string[], days?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const { action, ids, days } = body;

    switch (action) {
      case 'retry': {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
        }
        const { succeeded, failed } = await dlq.bulkRetryDLQ(ids);
        return NextResponse.json({ succeeded, failed });
      }

      case 'retry_all': {
        const { entries } = await dlq.listDLQEntries(ctx.tenantId, { limit: 1000, status: 'pending' });
        const entryIds = entries.map((e: any) => e.id);
        if (entryIds.length === 0) {
          return NextResponse.json({ succeeded: 0, failed: 0, message: 'No pending DLQ entries' });
        }
        const { succeeded, failed } = await dlq.bulkRetryDLQ(entryIds);
        return NextResponse.json({ succeeded, failed, total: entryIds.length });
      }

      case 'purge': {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
        }
        let purged = 0;
        for (const id of ids) {
          const result = await dlq.purgeDLQEntry(id, ctx.tenantId);
          if (result) purged++;
        }
        return NextResponse.json({ purged });
      }

      case 'purge_old': {
        const daysOld = days || 30;
        const purged = await dlq.purgeOldDLQEntries(daysOld);
        return NextResponse.json({ purged, daysOld });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    return apiError(err);
  }
}
