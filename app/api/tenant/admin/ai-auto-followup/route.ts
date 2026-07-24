import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    const stored = (((t?.settings as Record<string, unknown>) ?? {}).ai_auto_followup ?? {}) as Record<string, unknown>;
    const autoAiEnabled = stored.autoAiEnabled === true;

    return NextResponse.json({ autoAiEnabled });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    if (typeof body.autoAiEnabled !== 'boolean') {
      return NextResponse.json({ error: 'autoAiEnabled boolean required' }, { status: 400 });
    }

    const safe = { autoAiEnabled: body.autoAiEnabled };

    await db
      .update(tenants)
      .set({
        settings: sql`
          jsonb_set(
            COALESCE(${tenants.settings}, '{}'::jsonb),
            '{ai_auto_followup}',
            COALESCE(${tenants.settings}->'ai_auto_followup', '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_ai_auto_followup', entityType: 'tenant',
      newData: safe,
    });

    return NextResponse.json({ ok: true, autoAiEnabled: safe.autoAiEnabled });
  } catch (err) {
    console.error('[ai-auto-followup PATCH]', err);
    return apiError(err);
  }
}
