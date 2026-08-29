/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError, notFound } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customPlugins, pluginExecutionLogs } from '@/drizzle/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withApiRoute(async (request: NextRequest, context: RouteContext) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    // Verify plugin belongs to tenant
    const [plugin] = await db.select({ id: customPlugins.id })
      .from(customPlugins)
      .where(and(
        eq(customPlugins.id, id),
        eq(customPlugins.tenantId, ctx.tenantId),
        isNull(customPlugins.deletedAt)
      ))
      .limit(1);

    if (!plugin) {
      return notFound('Plugin');
    }

    const logs = await db.select()
      .from(pluginExecutionLogs)
      .where(and(
        eq(pluginExecutionLogs.pluginId, id),
        eq(pluginExecutionLogs.tenantId, ctx.tenantId)
      ))
      .orderBy(desc(pluginExecutionLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const data = logs.map((log) => ({
      id: log.id,
      actionName: log.actionName,
      method: log.method,
      url: log.url,
      responseStatus: log.responseStatus,
      durationMs: log.durationMs,
      success: log.success,
      errorMessage: log.errorMessage,
      createdAt: log.createdAt.toISOString(),
    }));

    return NextResponse.json({ data, limit, offset });
  } catch (err: unknown) {
    return apiError(err);
  }
});
