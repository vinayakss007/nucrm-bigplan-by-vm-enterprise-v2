import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

const TRASH_RETENTION_KEY = 'trash_retention_days';

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
  } catch (err: any) {
    console.error('[trash-settings GET]', err);
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

    const { retention_days } = await request.json();
    
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
        set: { value: String(retention_days) },
      });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[trash-settings PUT]', err);
    return apiError(err);
  }
}