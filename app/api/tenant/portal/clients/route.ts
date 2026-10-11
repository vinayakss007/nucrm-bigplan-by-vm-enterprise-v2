/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { portalClients, platformSettings } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { decodeSettingValue } from '@/lib/api/setting-value';

const PORTAL_CONFIG_KEY = 'portal_config';

/**
 * #2522: `portal_clients.access_token` is a bearer credential, not a display field.
 * `app/api/tenant/portal/login/route.ts:131` compares the request token against this
 * column with `timingSafeEqual` — holding it *is* being that portal client, for the
 * full 365-day lifetime `POST` below issues. The admin page lists clients, never
 * their tokens, so the token is not selected at all: an accidental `...row` in a
 * future response cannot resurrect the leak if the value was never read.
 *
 * `POST` stays the show-once path (#2459 convention) that hands the freshly minted
 * token to the admin so it can be copied into the invite link.
 */
const CLIENT_COLUMNS = {
  id: portalClients.id,
  name: portalClients.name,
  email: portalClients.email,
  isActive: portalClients.isActive,
  lastLoginAt: portalClients.lastLoginAt,
  expiresAt: portalClients.expiresAt,
  createdAt: portalClients.createdAt,
};

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const clients = await db
      .select(CLIENT_COLUMNS)
      .from(portalClients)
      .where(eq(portalClients.tenantId, ctx.tenantId))
      .orderBy(desc(portalClients.createdAt));

    return NextResponse.json({ data: clients });
 
 
  } catch (err) {
    await logError({ error: err, context: 'portal clients GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const [configSetting] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, PORTAL_CONFIG_KEY)
      ))
      .limit(1);

    const config = decodeSettingValue<Record<string, unknown>>(configSetting?.value, {}, 'object');
    if (!config.enabled) {
      return NextResponse.json({ error: 'Enable portal in settings first' }, { status: 400 });
    }

    const { name, email } = await readJsonBody(request);

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email required' }, { status: 400 });
    }

    const accessToken = uuidv4();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const [client] = await db
      .insert(portalClients)
      .values({
        tenantId: ctx.tenantId,
        name,
        email,
        accessToken,
        expiresAt,
        createdBy: ctx.userId,
      })
      .returning(CLIENT_COLUMNS);

    // Show-once by design: `access_token` appears here and nowhere else, so the
    // camelCase column name must not ride along on the projected row as well.
    return NextResponse.json({
      ok: true,
      data: {
        ...client,
        access_token: accessToken,
        login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/portal/login?token=${accessToken}&email=${email}`,
      },
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'portal clients POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'portalClients', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await readJsonBody(request);

    await db
      .delete(portalClients)
      .where(and(eq(portalClients.id, id), eq(portalClients.tenantId, ctx.tenantId)));

    return NextResponse.json({ ok: true });
 
 
  } catch (err) {
    await logError({ error: err, context: 'portal clients DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});