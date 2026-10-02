/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { usageAlerts } from '@/drizzle/schema';
import { asc, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/superadmin/token-control/alerts
 * The Alerts tab. Unacknowledged first, because the tab's only action is to
 * acknowledge — a newest-first list hides what still needs answering.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const parsed = validateBody(querySchema, Object.fromEntries(new URL(request.url).searchParams));
    if (parsed instanceof NextResponse) return parsed;

    const rows = await db
      .select({
        id: usageAlerts.id,
        tenant_id: usageAlerts.tenantId,
        alert_type: usageAlerts.alertType,
        target_type: usageAlerts.targetType,
        service: usageAlerts.service,
        current_value: usageAlerts.currentValue,
        threshold_value: usageAlerts.thresholdValue,
        message: usageAlerts.message,
        acknowledged: usageAlerts.acknowledged,
        created_at: usageAlerts.createdAt,
      })
      .from(usageAlerts)
      .orderBy(asc(usageAlerts.acknowledged), desc(usageAlerts.createdAt))
      .limit(parsed.data.limit);

    return NextResponse.json({ alerts: rows });
  } catch (err: unknown) { return apiError(err); }
});
