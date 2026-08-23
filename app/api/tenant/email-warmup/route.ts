/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { emailWarmupConfigSchema } from '@/lib/api/schemas';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { emailWarmupConfigs, emailWarmupPool } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { getWarmUpStats } from '@/lib/email/warmup';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const rawBody = await readJsonBody(request);
    const validated = validateBody(emailWarmupConfigSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { from_email, from_name, daily_limit_start, daily_limit_max, ramp_up_days, participants } = v;

    if (!from_email) {
      return NextResponse.json({ error: 'from_email is required' }, { status: 400 });
    }

    const [_config] = await db.transaction(async (tx) => {
      const [cfg] = await tx.insert(emailWarmupConfigs)
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

      const configId = cfg?.id;

      if (Array.isArray(participants) && participants.length > 0) {
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const poolValues = participants.map((p: any) => ({
          configId: configId!,
          participantEmail: p.email,
          participantName: p.name || '',
          status: 'active',
        } as typeof emailWarmupPool.$inferInsert));

        await tx.insert(emailWarmupPool)
          .values(poolValues)
          .onConflictDoNothing({
            target: [emailWarmupPool.configId, emailWarmupPool.participantEmail]
          });
      }

      return [cfg];
    });

    return NextResponse.json({ ok: true, message: 'Warm-up configured' }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err);
  }
}

/**
 * PATCH /api/tenant/email-warmup/toggle
 * Enable/disable warm-up
 */
export async function PATCH(request: NextRequest) {
  try {
  const limited = await rateLimitMutating(request, 'emailTemplates', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const rawBody = await readJsonBody(request);
    const validateToggle = validateBody(emailWarmupConfigSchema, rawBody);
    if (validateToggle instanceof NextResponse) return validateToggle;
    const { is_active } = rawBody;

    // Optimistic concurrency: reject if another update happened since client read
    const [currentConfig] = await db.select({ id: emailWarmupConfigs.id })
      .from(emailWarmupConfigs)
      .where(eq(emailWarmupConfigs.tenantId, ctx.tenantId))
      .limit(1);
    const expectedUpdatedAt = rawBody.expectedUpdatedAt ? new Date(rawBody.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, emailWarmupConfigs, currentConfig?.id ?? null, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    await db.update(emailWarmupConfigs)
      .set({ isActive: is_active, updatedAt: new Date() })
      .where(eq(emailWarmupConfigs.tenantId, ctx.tenantId));

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
