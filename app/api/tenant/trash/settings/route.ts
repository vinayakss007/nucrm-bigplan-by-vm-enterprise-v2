/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

const TRASH_RETENTION_KEY = 'trash_retention_days';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const [setting] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, TRASH_RETENTION_KEY)
      ))
      .limit(1);

    return NextResponse.json({ 
      data: { 
        retention_days: parseInt(String(setting?.value || '30')),
        options: [
          { value: 7, label: '7 days' },
          { value: 30, label: '30 days' },
          { value: 60, label: '60 days' },
          { value: 90, label: '90 days' },
          { value: 180, label: '6 months' },
          { value: 365, label: '1 year' },
        ]
      }
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'trash/settings GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const PUT = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const limited = await rateLimitMutating(request, 'trash', 'put');
    if (limited) return limited;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { retention_days } = await readJsonBody(request);
    
    if (!retention_days || retention_days < 1) {
      return NextResponse.json({ error: 'Invalid retention_days' }, { status: 400 });
    }

    await db
      .insert(platformSettings)
      .values({
        tenantId: ctx.tenantId,
        key: TRASH_RETENTION_KEY,
        value: String(retention_days),
      })
      .onConflictDoUpdate({
        target: [platformSettings.tenantId, platformSettings.key],
        set: { value: String(retention_days), updatedAt: new Date() },
      });

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'trash/settings PUT', requestMethod: 'PUT' });
    return apiError(err);
  }
});