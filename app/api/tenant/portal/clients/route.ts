import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { portalClients, platformSettings } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const PORTAL_CONFIG_KEY = 'portal_config';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const clients = await db
      .select()
      .from(portalClients)
      .where(eq(portalClients.tenantId, ctx.tenantId))
      .orderBy(desc(portalClients.createdAt));

    return NextResponse.json({ data: clients });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[portal clients GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
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

    const config = configSetting?.value ? JSON.parse(String(configSetting.value)) : {};
    if (!config.enabled) {
      return NextResponse.json({ error: 'Enable portal in settings first' }, { status: 400 });
    }

    const { name, email } = await request.json();

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
      .returning();

    return NextResponse.json({
      ok: true,
      data: {
        ...client,
        access_token: accessToken,
        login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/portal/login?token=${accessToken}&email=${email}`,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[portal clients POST]', err);
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

    const { id } = await request.json();

    await db
      .delete(portalClients)
      .where(and(eq(portalClients.id, id), eq(portalClients.tenantId, ctx.tenantId)));

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[portal clients DELETE]', err);
    return apiError(err);
  }
}