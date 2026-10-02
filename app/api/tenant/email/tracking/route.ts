/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { emailLog } from '@/drizzle/schema';
import { emailOpens } from '@/drizzle/schema/email-tracking';
import { and, desc, eq, inArray, min } from 'drizzle-orm';
import { validateBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { z } from 'zod';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

/**
 * Sent-mail history — `/api/tenant/email/test-send` records what this reads.
 * Open state is joined from `email_opens` because the page shows "Opened" in
 * place of the delivery status once a message has been seen.
 */
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const parsed = validateBody(listQuerySchema, Object.fromEntries(new URL(req.url).searchParams));
    if (parsed instanceof NextResponse) return parsed;
    const { limit, offset } = parsed.data;

    const rows = await db
      .select({
        id: emailLog.id,
        to: emailLog.toEmail,
        from: emailLog.fromEmail,
        subject: emailLog.subject,
        status: emailLog.status,
        provider: emailLog.provider,
        error: emailLog.errorMessage,
        contactId: emailLog.contactId,
        sentAt: emailLog.sentAt,
        createdAt: emailLog.createdAt,
      })
      .from(emailLog)
      .where(eq(emailLog.tenantId, ctx.tenantId))
      .orderBy(desc(emailLog.createdAt))
      .limit(limit)
      .offset(offset);

    const ids = rows.map(r => r.id);
    const opens = ids.length === 0 ? [] : await db
      .select({ emailId: emailOpens.emailId, openedAt: min(emailOpens.openedAt) })
      .from(emailOpens)
      .where(and(eq(emailOpens.tenantId, ctx.tenantId), inArray(emailOpens.emailId, ids)))
      .groupBy(emailOpens.emailId);
    const openedBy = new Map(opens.map(o => [o.emailId, o.openedAt]));

    return NextResponse.json({
      data: rows.map(r => ({ ...r, opened_at: openedBy.get(r.id) ?? null })),
    });
  } catch (err: unknown) { return apiError(err); }
});
