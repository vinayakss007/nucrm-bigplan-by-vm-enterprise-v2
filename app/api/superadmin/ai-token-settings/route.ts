import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { aiTokenUsage } from '@/drizzle/schema/ai-token-usage';
import { PLAN_MAP } from '@/lib/plans/plan-definitions';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Super Admin AI Token Settings API
 *
 * GET  - List all tenants with their AI token usage for the current billing period
 * PATCH - Set a custom token limit override or reset usage for a tenant
 */

function getCurrentBillingPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const billingPeriod = getCurrentBillingPeriod();

    // Fetch all tenants with their usage for the current period
    const allTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        planId: tenants.planId,
        tokensUsed: aiTokenUsage.tokensUsed,
        tokensLimit: aiTokenUsage.tokensLimit,
        resetAt: aiTokenUsage.resetAt,
      })
      .from(tenants)
      .leftJoin(
        aiTokenUsage,
        and(
          eq(aiTokenUsage.tenantId, tenants.id),
          eq(aiTokenUsage.billingPeriod, billingPeriod),
        ),
      )
      .orderBy(tenants.name);

    // Compute effective limits and percentages
    const results = allTenants.map((t) => {
      const plan = PLAN_MAP[t.planId ?? 'free'];
      const planLimit = plan?.maxAiTokensMonthly ?? 10000;
      const effectiveLimit = t.tokensLimit != null ? t.tokensLimit : planLimit;
      const used = t.tokensUsed ?? 0;
      const percentage = effectiveLimit > 0 ? Math.round((used / effectiveLimit) * 100) : 0;
      const status = effectiveLimit === -1
        ? 'unlimited'
        : percentage >= 100
          ? 'exceeded'
          : percentage >= 80
            ? 'warning'
            : 'ok';

      return {
        tenant_id: t.id,
        name: t.name,
        slug: t.slug,
        plan_id: t.planId,
        plan_name: plan?.name ?? 'Unknown',
        tokens_used: used,
        tokens_limit: effectiveLimit,
        has_override: t.tokensLimit != null,
        percentage,
        status,
        reset_at: t.resetAt,
      };
    });

    const totalUsed = results.reduce((sum, r) => sum + r.tokens_used, 0);

    return NextResponse.json({
      success: true,
      billing_period: billingPeriod,
      total_tokens_used: totalUsed,
      tenants: results,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const { tenant_id, tokens_limit, action } = body;

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    const billingPeriod = getCurrentBillingPeriod();

    // Action: reset usage counter
    if (action === 'reset') {
      await db
        .insert(aiTokenUsage)
        .values({
          tenantId: tenant_id,
          billingPeriod,
          tokensUsed: 0,
          resetAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [aiTokenUsage.tenantId, aiTokenUsage.billingPeriod],
          set: {
            tokensUsed: 0,
            resetAt: new Date(),
            updatedAt: new Date(),
          },
        });

      return NextResponse.json({ success: true, message: 'Usage reset to 0' });
    }

    // Default action: set custom token limit override
    if (tokens_limit === undefined || tokens_limit === null) {
      return NextResponse.json({ error: 'tokens_limit is required (use -1 for unlimited, 0 to block, or null action=reset to reset)' }, { status: 400 });
    }

    await db
      .insert(aiTokenUsage)
      .values({
        tenantId: tenant_id,
        billingPeriod,
        tokensUsed: 0,
        tokensLimit: tokens_limit,
      })
      .onConflictDoUpdate({
        target: [aiTokenUsage.tenantId, aiTokenUsage.billingPeriod],
        set: {
          tokensLimit: tokens_limit,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      success: true,
      message: `Token limit set to ${tokens_limit === -1 ? 'unlimited' : tokens_limit.toLocaleString()}`,
    });
  } catch (err) {
    return apiError(err);
  }
}
