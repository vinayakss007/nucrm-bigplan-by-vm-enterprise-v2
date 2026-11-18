/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { notifications } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const [result] = await db.select({
      count: sql<number>`count(*)::int`
    })
    .from(notifications)
    .where(and(
      eq(notifications.tenantId, ctx.tenantId),
      eq(notifications.userId, ctx.userId),
      isNull(notifications.readAt),
      isNull(notifications.deletedAt)
    ));

    return NextResponse.json({ count: result?.count ?? 0 });
  } catch (err) {
    // #3408: a DB failure is not "zero unread notifications". Answering 200
    // with count:0 made every consumer render a clean badge over an outage.
    await logError({ error: err, context: 'tenant/notifications/unread GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Could not load unread count' }, { status: 500 });
  }
});
