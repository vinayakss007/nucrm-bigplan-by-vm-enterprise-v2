import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { ticketReplies } from '@/drizzle/schema';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const permErr = requirePerm(ctx, 'tickets.manage');
    if (permErr) return permErr;

    const body = await request.json();
    if (!body.body?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 });

    await db.insert(ticketReplies).values({
      tenantId: ctx.tenantId,
      ticketId: id,
      userId: ctx.userId,
      body: body.body,
      isInternal: body.is_internal || false,
    });

    return NextResponse.json({ success: true }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ticket reply POST]', err);
    return apiError(err);
  }
}
