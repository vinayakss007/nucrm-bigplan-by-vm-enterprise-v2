import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { emailWarmupConfigs, emailWarmupPool } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getWarmUpStats } from '@/lib/email/warmup';

/**
 * GET /api/tenant/email-warmup
 * Get warm-up config and stats for current tenant
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const [config] = await db.select()
      .from(emailWarmupConfigs)
      .where(eq(emailWarmupConfigs.tenantId, ctx.tenantId))
      .orderBy(desc(emailWarmupConfigs.createdAt))
      .limit(1);

    const stats = config ? await getWarmUpStats(ctx.tenantId) : null;

    const pool = config ? await db.select()
      .from(emailWarmupPool)
      .where(eq(emailWarmupPool.configId, config.id))
      .orderBy(desc(emailWarmupPool.createdAt)) : [];

    return NextResponse.json({
      config,
      stats,
      pool,
    });
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/email-warmup
 * Create or update warm-up config
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { from_email, from_name, daily_limit_start, daily_limit_max, ramp_up_days, participants } = body;

    if (!from_email) {
      return NextResponse.json({ error: 'from_email is required' }, { status: 400 });
    }

    const [config] = await db.insert(emailWarmupConfigs)
      .values({
        tenantId: ctx.tenantId,
        fromEmail: from_email,
        fromName: from_name || '',
        dailyLimitStart: daily_limit_start || 5,
        dailyLimitMax: daily_limit_max || 50,
        rampUpDays: ramp_up_days || 21,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [emailWarmupConfigs.tenantId, emailWarmupConfigs.fromEmail],
        set: {
          fromName: from_name || '',
          dailyLimitStart: daily_limit_start || 5,
          dailyLimitMax: daily_limit_max || 50,
          rampUpDays: ramp_up_days || 21,
          isActive: true,
          updatedAt: new Date(),
        }
      })
      .returning();

    const configId = (config as any)?.[0]?.id;

    // Add participants to pool
    if (Array.isArray(participants) && participants.length > 0) {
      const poolValues = participants.map((p: any) => ({
        configId,
        participantEmail: p.email,
        participantName: p.name || '',
        status: 'active',
      }));

      await db.insert(emailWarmupPool)
        .values(poolValues)
        .onConflictDoNothing({
          target: [emailWarmupPool.configId, emailWarmupPool.participantEmail]
        });
    }

    return NextResponse.json({ ok: true, message: 'Warm-up configured' }, { status: 201 });
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * PATCH /api/tenant/email-warmup/toggle
 * Enable/disable warm-up
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { is_active } = body;

    await db.update(emailWarmupConfigs)
      .set({ isActive: is_active, updatedAt: new Date() })
      .where(eq(emailWarmupConfigs.tenantId, ctx.tenantId));

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return apiError(err);
  }
}
