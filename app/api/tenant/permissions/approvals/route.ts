import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { approveRequest, rejectRequest } from '@/lib/rbac/approval-workflows';
import { db } from '@/drizzle/db';
import { approvalRequests } from '@/drizzle/schema/core';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const approvalActionSchema = z.object({
  request_id: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(1000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'pending';
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));

    const results = await db.select()
      .from(approvalRequests)
      .where(and(
        eq(approvalRequests.tenantId, ctx.tenantId),
        eq(approvalRequests.status, status)
      ))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ data: results });
  } catch (err: unknown) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
    const validated = validateBody(approvalActionSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    let result;
    if (v.action === 'approve') {
      result = await approveRequest(v.request_id, ctx.userId);
    } else {
      result = await rejectRequest(v.request_id, ctx.userId, v.reason || 'No reason provided');
    }

    if (!result) {
      return NextResponse.json(
        { error: 'Approval request not found or already processed' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: result });
  } catch (err: unknown) { return apiError(err); }
}
