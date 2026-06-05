/**
 * Approve or reject a pending approval request
 *
 *   PATCH /api/tenant/approvals/[id]
 *   body: { action: 'approve' | 'reject', reason?: string }
 *
 * Admin-only. Tenant-scoped — the engine looks up by request id but we
 * verify the row belongs to the calling tenant before invoking the
 * shared engine helpers (which already log activities + audit).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { approvalRequests } from '@/drizzle/schema/core';
import { eq, and } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { approveRequest, rejectRequest } from '@/lib/rbac/approval-workflows';

interface PatchBody {
  action?: 'approve' | 'reject';
  reason?: string;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'request id required' }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as PatchBody;
    const action = body.action;
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
    if (action === 'reject' && !reason) {
      return NextResponse.json({ error: 'reason is required when rejecting' }, { status: 400 });
    }

    // Tenant-scope check before delegating to the engine
    const existing = await db.query.approvalRequests.findFirst({
      where: and(
        eq(approvalRequests.id, id),
        eq(approvalRequests.tenantId, ctx.tenantId),
      ),
    });
    if (!existing) {
      return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
    }
    if (existing.status !== 'pending') {
      return NextResponse.json({
        error: `Approval request is already ${existing.status} — cannot ${action}`,
      }, { status: 409 });
    }

    let result;
    if (action === 'approve') {
      result = await approveRequest(id, ctx.userId);
    } else {
      result = await rejectRequest(id, ctx.userId, reason);
    }

    if (!result) {
      return NextResponse.json({ error: 'Failed to update approval request' }, { status: 500 });
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: action === 'approve' ? 'approval_approved' : 'approval_rejected',
      entityType: 'approval_request',
      entityId: id,
      newData: { reason, target_entity_type: existing.entityType, target_entity_id: existing.entityId },
    });

    return NextResponse.json({
      ok: true,
      id,
      status: action === 'approve' ? 'approved' : 'rejected',
      reason: action === 'reject' ? reason : null,
    });
  } catch (err) {
    return apiError(err);
  }
}
