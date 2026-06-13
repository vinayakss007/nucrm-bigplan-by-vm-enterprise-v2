import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { ipWhitelistSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

const IP_WHITELIST_KEY = 'ip_whitelist';

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
        eq(platformSettings.key, IP_WHITELIST_KEY)
      ))
      .limit(1);

    const ips = setting?.value ? JSON.parse(String(setting.value)) : [];

    return NextResponse.json({ data: { ips, enabled: ips.length > 0 } });
  } catch (err: any) {
    console.error('[ip-whitelist GET]', err);
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

    const rawBody = await request.json();
    const validated = validateBody(ipWhitelistSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const ipArray = v.ips;
    const enabled = v.enabled;

    const value = enabled && ipArray.length > 0 ? JSON.stringify(ipArray) : '[]';

    await db
      .insert(platformSettings)
      .values({
        tenantId: ctx.tenantId,
        key: IP_WHITELIST_KEY,
        value,
      })
      .onConflictDoUpdate({
        target: [platformSettings.tenantId, platformSettings.key],
        set: { value },
      });

    return NextResponse.json({ ok: true, ips: ipArray, enabled: enabled && ipArray.length > 0 });
  } catch (err: any) {
    console.error('[ip-whitelist PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
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
  } catch (err: any) {
    console.error('[ip-whitelist DELETE]', err);
    return apiError(err);
  }
}