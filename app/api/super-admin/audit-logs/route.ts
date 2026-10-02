/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
/**
 * Super Admin Audit Logs API
 * GET /api/super-admin/audit-logs - List audit logs
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { superAdminAuditLogs } from '@/drizzle/schema';
import { requireAuth } from '@/lib/auth/middleware';
import { eq, and, or, gte, lte, ilike, desc, count } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { isUuid } from '@/lib/id';
import { verifySuperAdminAuditChain } from '@/lib/audit/super-admin';

// The list page asks for 100; the CSV export asks for 10000 in one request. The
// old cap was 100 for both, so an export over more than a page silently wrote a
// partial file.
const MAX_LIMIT = 10000;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = parseInt(raw ?? String(fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** null = malformed, undefined = absent, otherwise the parsed date. */
function parseDateParam(raw: string | null): Date | null | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Super Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    // The chain verifier had no reader at all: nothing imported
    // verifySuperAdminAuditChain, so the trail was tamper-evident in theory and
    // unverifiable in practice. One row is enough to expose a break, so this runs
    // before the list filters, which narrow what a caller is looking for rather
    // than what the chain covers.
    if (searchParams.get('verify') === '1') {
      const verification = await verifySuperAdminAuditChain();
      return NextResponse.json({ verification });
    }

    const adminId = searchParams.get('admin_id');
    const action = searchParams.get('action');
    const targetType = searchParams.get('target_type');
    const tenantId = searchParams.get('tenant_id');
    const search = searchParams.get('search');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = clampInt(searchParams.get('limit'), 50, 1, MAX_LIMIT);
    const offset = clampInt(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);

    // admin_id and tenant_id are uuid columns and the dates become timestamptz
    // params, so a malformed value is rejected while the query is being planned.
    // Postgres raised 22P02 and apiError mapped it to 404 "not found": the
    // filter looked broken to the caller, the real reason only reached error_logs,
    // and every keystroke added a row there. Reject it here, before the query.
    if ((adminId && !isUuid(adminId)) || (tenantId && !isUuid(tenantId))) {
      return NextResponse.json(
        { error: 'admin_id and tenant_id must be UUIDs' },
        { status: 400 },
      );
    }
    const startAt = parseDateParam(startDate);
    const endAt = parseDateParam(endDate);
    if (startAt === null || endAt === null) {
      return NextResponse.json(
        { error: 'start_date and end_date must be ISO timestamps' },
        { status: 400 },
      );
    }

    const conditions = [];

    if (adminId) {
      conditions.push(eq(superAdminAuditLogs.adminId, adminId));
    }
    if (action) {
      conditions.push(eq(superAdminAuditLogs.action, action));
    }
    if (targetType) {
      conditions.push(eq(superAdminAuditLogs.targetType, targetType));
    }
    if (tenantId) {
      conditions.push(eq(superAdminAuditLogs.tenantId, tenantId));
    }
    // The panel's "Search action or type…" box has always sent this param and the
    // route never read it, so the box silently filtered nothing at all.
    if (search) {
      const like = `%${search}%`;
      const searchCond = or(
        ilike(superAdminAuditLogs.action, like),
        ilike(superAdminAuditLogs.targetType, like),
        ilike(superAdminAuditLogs.targetName, like),
        ilike(superAdminAuditLogs.adminEmail, like),
      );
      if (searchCond) conditions.push(searchCond);
    }
    if (startAt) {
      conditions.push(gte(superAdminAuditLogs.createdAt, startAt));
    }
    if (endAt) {
      conditions.push(lte(superAdminAuditLogs.createdAt, endAt));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logsResult = await db
      .select()
      .from(superAdminAuditLogs)
      .where(whereClause)
      .orderBy(desc(superAdminAuditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ total: count() })
      .from(superAdminAuditLogs)
      .where(whereClause);

    return NextResponse.json({
      data: logsResult,
      total: countResult[0]?.total ?? 0,
      limit,
      offset,
    });

  } catch (err) {
    void logError({ error: err, context: 'super-admin/audit-logs GET' });
    return apiError(err);
  }
});
