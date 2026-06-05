/**
 * Approvals inbox endpoint (manager-facing)
 *
 *   GET /api/tenant/approvals?status=pending|approved|rejected|all&entity_type=&limit=&offset=
 *
 * Joins approval_requests with users (requestedBy / approvedBy / rejectedBy)
 * so the inbox UI can render names without a second round trip.
 *
 * Returns:
 *   {
 *     rows: [{ id, entity_type, entity_id, rule_id, status, reason,
 *              requested_at, requested_by_name, requested_by_email,
 *              decided_at, decided_by_name }],
 *     summary: { pending, approved, rejected }
 *   }
 *
 * Admin-only. Tenant-scoped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { approvalRequests, users } from '@/drizzle/schema/core';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { apiError } from '@/lib/api-error';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'all']);

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const sp = req.nextUrl.searchParams;
    const status = sp.get('status') ?? 'pending';
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: `status must be one of ${[...VALID_STATUSES].join(', ')}` }, { status: 400 });
    }
    const entityType = sp.get('entity_type');
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50));
    const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);

    // Aliases so we can join the users table three different ways
    const requester = alias(users, 'requester');
    const approver  = alias(users, 'approver');
    const rejecter  = alias(users, 'rejecter');

    const filters = [eq(approvalRequests.tenantId, ctx.tenantId)];
    if (status !== 'all') filters.push(eq(approvalRequests.status, status));
    if (entityType) filters.push(eq(approvalRequests.entityType, entityType.slice(0, 50)));

    const where = and(...filters);

    const [rowsRaw, summaryRaw, totalRow] = await Promise.all([
      db
        .select({
          id: approvalRequests.id,
          entity_type: approvalRequests.entityType,
          entity_id: approvalRequests.entityId,
          rule_id: approvalRequests.ruleId,
          status: approvalRequests.status,
          reason: approvalRequests.reason,
          requested_at: approvalRequests.createdAt,
          decided_at: approvalRequests.updatedAt,
          requested_by_id: approvalRequests.requestedBy,
          approved_by_id: approvalRequests.approvedBy,
          rejected_by_id: approvalRequests.rejectedBy,
          requested_by_name: requester.fullName,
          requested_by_email: requester.email,
          approver_name: approver.fullName,
          rejecter_name: rejecter.fullName,
        })
        .from(approvalRequests)
        .leftJoin(requester, eq(approvalRequests.requestedBy, requester.id))
        .leftJoin(approver, eq(approvalRequests.approvedBy, approver.id))
        .leftJoin(rejecter, eq(approvalRequests.rejectedBy, rejecter.id))
        .where(where)
        .orderBy(desc(approvalRequests.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({
          status: approvalRequests.status,
          n: sql<number>`count(*)::int`,
        })
        .from(approvalRequests)
        .where(eq(approvalRequests.tenantId, ctx.tenantId))
        .groupBy(approvalRequests.status),
      db
        .select({ value: count() })
        .from(approvalRequests)
        .where(where),
    ]);

    const total = Number(totalRow[0]?.value ?? 0);

    const summary: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const row of summaryRaw) {
      if (row.status in summary) summary[row.status] = Number(row.n);
    }

    const rows = rowsRaw.map(r => ({
      ...r,
      decided_by_name: r.status === 'approved' ? r.approver_name : r.status === 'rejected' ? r.rejecter_name : null,
    }));

    return NextResponse.json({
      rows,
      pagination: { limit, offset, total },
      summary,
    });
  } catch (err) {
    return apiError(err);
  }
}
