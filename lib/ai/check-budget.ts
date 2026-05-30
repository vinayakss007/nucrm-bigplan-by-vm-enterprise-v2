import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { aiTokenUsage } from '@/drizzle/schema/ai-token-usage';
import { PLAN_MAP } from '@/lib/plans/plan-definitions';
import { eq, and, sql } from 'drizzle-orm';

export interface AiTokenBudgetResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Get the current billing period string in 'YYYY-MM' format.
 */
function getCurrentBillingPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Check if a tenant has remaining AI token budget for the current billing period.
 *
 * Resolution order for the limit:
 *   1. Custom override in aiTokenUsage.tokens_limit for this period (set by super admin)
 *   2. Plan default from PLAN_MAP[planId].maxAiTokensMonthly
 *
 * If the resolved limit is -1, the tenant has unlimited tokens.
 */
export async function checkAiTokenBudget(tenantId: string): Promise<AiTokenBudgetResult> {
  const billingPeriod = getCurrentBillingPeriod();

  // Fetch tenant plan and current usage in parallel
  const [tenant, usageRow] = await Promise.all([
    db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { planId: true },
    }),
    db.query.aiTokenUsage.findFirst({
      where: and(
        eq(aiTokenUsage.tenantId, tenantId),
        eq(aiTokenUsage.billingPeriod, billingPeriod),
      ),
    }),
  ]);

  // Resolve plan limit
  const planId = tenant?.planId ?? 'free';
  const plan = PLAN_MAP[planId];
  const planLimit = plan?.maxAiTokensMonthly ?? 10000;

  // Check for super admin override
  const effectiveLimit = usageRow?.tokensLimit != null ? usageRow.tokensLimit : planLimit;

  // Current usage
  const used = usageRow?.tokensUsed ?? 0;

  // Unlimited plan
  if (effectiveLimit === -1) {
    return { allowed: true, used, limit: -1, remaining: -1 };
  }

  const remaining = Math.max(0, effectiveLimit - used);
  const allowed = used < effectiveLimit;

  return { allowed, used, limit: effectiveLimit, remaining };
}

/**
 * Record AI token usage for a tenant in the current billing period.
 * Upserts the aiTokenUsage row, incrementing tokens_used.
 */
export async function recordAiTokenUsage(tenantId: string, tokensUsed: number): Promise<void> {
  const billingPeriod = getCurrentBillingPeriod();

  await db
    .insert(aiTokenUsage)
    .values({
      tenantId,
      billingPeriod,
      tokensUsed,
    })
    .onConflictDoUpdate({
      target: [aiTokenUsage.tenantId, aiTokenUsage.billingPeriod],
      set: {
        tokensUsed: sql`${aiTokenUsage.tokensUsed} + ${tokensUsed}`,
        updatedAt: new Date(),
      },
    });
}
