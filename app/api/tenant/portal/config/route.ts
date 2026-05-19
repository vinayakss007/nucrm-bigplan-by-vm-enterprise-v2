import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

const PORTAL_CONFIG_KEY = 'portal_config';

export async function GET(request: NextRequest) {
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
        eq(platformSettings.key, PORTAL_CONFIG_KEY)
      ))
      .limit(1);

    const config = setting?.value ? JSON.parse(String(setting.value)) : {
      enabled: false,
      allow_quotes: true,
      allow_invoices: true,
      allow_cases: true,
      custom_message: '',
    };

    return NextResponse.json({ data: config });
  } catch (err: any) {
    console.error('[portal config GET]', err);
    return apiError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const config = await request.json();

    await db
      .insert(platformSettings)
      .values({
        tenantId: ctx.tenantId,
        key: PORTAL_CONFIG_KEY,
        value: JSON.stringify(config),
      })
      .onConflictDoUpdate({
        target: [platformSettings.tenantId, platformSettings.key],
        set: { value: JSON.stringify(config) },
      });

    return NextResponse.json({ ok: true, data: config });
  } catch (err: any) {
    console.error('[portal config PUT]', err);
    return apiError(err);
  }
}