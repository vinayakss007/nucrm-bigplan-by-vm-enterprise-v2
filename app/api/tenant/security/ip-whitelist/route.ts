/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { ipWhitelistSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

const IP_WHITELIST_KEY = 'ip_whitelist';

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
        eq(platformSettings.key, IP_WHITELIST_KEY)
      ))
      .limit(1);

    const ips = setting?.value ? JSON.parse(String(setting.value)) : [];

    return NextResponse.json({ data: { ips, enabled: ips.length > 0 } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'ip-whitelist GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const PUT = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const rawBody = await readJsonBody(request);
    const validated = validateBody(ipWhitelistSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const ipArray = v.ips;
    const enabled = v.enabled;

    const value = enabled && ipArray.length > 0 ? JSON.stringify(ipArray) : '[]';

    const expectedUpdatedAt: string | Date | null | undefined = (rawBody as Record<string, unknown>).expectedUpdatedAt as string | Date | null ?? (rawBody as Record<string, unknown>)._updated_at as string | Date | null;

    // Read existing row's id + updatedAt for concurrency check
    const [existing] = await db
      .select({ id: platformSettings.id, updatedAt: platformSettings.updatedAt })
      .from(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, IP_WHITELIST_KEY),
      ))
      .limit(1);

    const guard = await concurrencyGuard(db, platformSettings, existing?.id ?? null, ctx.tenantId, expectedUpdatedAt ?? existing?.updatedAt as string | Date | null | undefined);
    if (guard) return guard;

    await db
      .insert(platformSettings)
      .values({
        tenantId: ctx.tenantId,
        key: IP_WHITELIST_KEY,
        value,
      })
      .onConflictDoUpdate({
        target: [platformSettings.tenantId, platformSettings.key],
        set: { value, updatedAt: new Date() },
      });

    return NextResponse.json({ ok: true, ips: ipArray, enabled: enabled && ipArray.length > 0 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'ip-whitelist PUT', requestMethod: 'PUT' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'settings', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await db
      .delete(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, IP_WHITELIST_KEY)
      ));

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'ip-whitelist DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});