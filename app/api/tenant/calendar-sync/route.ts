import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { getProvider, getIntegrationConfig } from '@/lib/calendar-sync/service';

export async function GET(request: NextRequest) {
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
    const state = `${ctx.tenantId}:${ctx.userId}:${Date.now()}`;
    const authUrl = provider.getAuthUrl(state);

    return NextResponse.json({ authUrl, state });
  } catch (err: unknown) {
    console.error('[calendar-sync auth GET]', err);
    return NextResponse.json({ error: 'Failed to generate auth URL' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'calendar.manage');
    if (deny) return deny;

    const body = await request.json();
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
    console.error('[calendar-sync POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
