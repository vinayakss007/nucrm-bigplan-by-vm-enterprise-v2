/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { ticketReplies, supportTickets } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const permErr = requirePerm(ctx, 'tickets.manage');
    if (permErr) return permErr;

    const body = await readJsonBody(request);
    if (!body.body?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 });

    // Check if this is the first reply (for SLA first-response tracking)
    const [ticket] = await db.select({ firstResponseAt: supportTickets.firstResponseAt })
      .from(supportTickets)
      .where(and(eq(supportTickets.id, id), isNull(supportTickets.deletedAt)))
      .limit(1);

    const isFirstResponse = ticket && !ticket.firstResponseAt && !body.is_internal;

    await db.transaction(async (tx) => {
      await tx.insert(ticketReplies).values({
        tenantId: ctx.tenantId,
        ticketId: id,
        userId: ctx.userId,
        body: body.body,
        isInternal: body.is_internal || false,
      });

      if (isFirstResponse) {
        await tx.update(supportTickets)
          .set({ firstResponseAt: new Date() })
          .where(eq(supportTickets.id, id));
      }
    });

    return NextResponse.json({ success: true }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ticket reply POST]', err);
    return apiError(err);
  }
});
