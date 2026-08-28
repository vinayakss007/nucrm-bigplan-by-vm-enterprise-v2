/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { invoices } from '@/drizzle/schema';
import { sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';
import { logError, tenantMeta } from '@/lib/errors-server';

export async function GET(request: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    return withCache(tid, 'widget-invoices', 300, async () => {
      const result = await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM ${invoices} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status = 'draft') AS draft,
          (SELECT COUNT(*)::int FROM ${invoices} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status = 'sent') AS sent,
          (SELECT COUNT(*)::int FROM ${invoices} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status = 'overdue') AS overdue,
          (SELECT COUNT(*)::int FROM ${invoices} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status = 'paid') AS paid,
          (SELECT COUNT(*)::int FROM ${invoices} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status IN ('sent', 'overdue')) AS total_outstanding
      `);
      const row = result.rows?.[0] || {};
      return NextResponse.json({
        data: {
          draft: Number(row['draft'] ?? 0),
          sent: Number(row['sent'] ?? 0),
          overdue: Number(row['overdue'] ?? 0),
          paid: Number(row['paid'] ?? 0),
          totalOutstanding: Number(row['total_outstanding'] ?? 0),
        },
      });
    });
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/invoices', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
}
