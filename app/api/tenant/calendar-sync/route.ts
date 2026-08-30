/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { getProvider, getIntegrationConfig } from '@/lib/calendar-sync/service';
import { readJsonBody } from '@/lib/api/validate';
import { signOAuthState } from '@/lib/calendar-sync/state';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'calendar.manage');
    if (deny) return deny;

    const { searchParams } = new URL(request.url);
    const providerType = searchParams.get('provider') as 'google' | 'outlook';

    if (!providerType || !['google', 'outlook'].includes(providerType)) {
      return NextResponse.json({ error: 'provider param required (google|outlook)' }, { status: 400 });
    }

    const provider = getProvider(providerType);
    // #1175: sign the state so the callback can reject forged values
    const state = signOAuthState(`${ctx.tenantId}:${ctx.userId}:${Date.now()}`);
    const authUrl = provider.getAuthUrl(state);

    const response = NextResponse.json({ authUrl, state });
    response.cookies.set('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    return response;
  } catch (err: unknown) {
    void logError({ error: err, context: 'tenant/calendar-sync GET' });
    return NextResponse.json({ error: 'Failed to generate auth URL' }, { status: 500 });
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'calendarSync', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'calendar.manage');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const { provider: providerType, action } = body;

    if (!['google', 'outlook'].includes(providerType)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    if (action === 'status') {
      const integration = await getIntegrationConfig(ctx.tenantId, providerType);
      return NextResponse.json({
        connected: !!integration,
        syncEnabled: (integration?.config as Record<string, unknown>)?.syncEnabled ?? false,
        lastSyncAt: (integration?.config as Record<string, unknown>)?.lastSyncAt ?? null,
      });
    }

    if (action === 'disconnect') {
      const { db } = await import('@/drizzle/db');
      const { integrations } = await import('@/drizzle/schema');
      const { eq, and, isNull } = await import('drizzle-orm');

      await db
        .update(integrations)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(integrations.tenantId, ctx.tenantId),
            eq(integrations.type, providerType),
            isNull(integrations.deletedAt)
          )
        );

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: unknown) {
    void logError({ error: err, context: 'tenant/calendar-sync POST' });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
});
