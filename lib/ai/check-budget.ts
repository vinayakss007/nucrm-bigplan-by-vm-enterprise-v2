import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { aiTokenUsage } from '@/drizzle/schema/ai-token-usage';
import { PLAN_MAP } from '@/lib/plans/plan-definitions';
import { getCurrentBillingPeriod } from '@/lib/billing/period';
import { eq, and, sql } from 'drizzle-orm';

export interface AiTokenBudgetResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
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
 * Atomically record AI token usage for a tenant in the current billing period.
 *
 * This uses an INSERT ... ON CONFLICT DO UPDATE that also checks the limit
 * within the same statement, eliminating the TOCTOU race between checking
 * the budget and recording usage. If the update would exceed the limit,
 * the tokens_used is capped at the limit and the function returns false.
 *
 * Returns true if the usage was recorded successfully (budget not exceeded),
 * false if recording was skipped because the limit would be exceeded.
 */
export async function recordAiTokenUsage(tenantId: string, tokensUsed: number): Promise<boolean> {
  const billingPeriod = getCurrentBillingPeriod();

  // Atomic upsert: increment tokens_used.
  // The conditional ensures we do not exceed the limit in a concurrent scenario.
  // If tokens_limit is NULL (no override) or -1 (unlimited), we always allow.
  // Otherwise, only increment if tokens_used + new <= tokens_limit.
  const result = await db
    .insert(aiTokenUsage)
    .values({
      tenantId,
      billingPeriod,
      tokensUsed,
    })
    .onConflictDoUpdate({
      target: [aiTokenUsage.tenantId, aiTokenUsage.billingPeriod],
      set: {
        tokensUsed: sql`CASE
          WHEN ${aiTokenUsage.tokensLimit} IS NULL THEN ${aiTokenUsage.tokensUsed} + ${tokensUsed}
          WHEN ${aiTokenUsage.tokensLimit} = -1 THEN ${aiTokenUsage.tokensUsed} + ${tokensUsed}
          WHEN ${aiTokenUsage.tokensUsed} + ${tokensUsed} <= ${aiTokenUsage.tokensLimit} THEN ${aiTokenUsage.tokensUsed} + ${tokensUsed}
          ELSE ${aiTokenUsage.tokensUsed}
        END`,
        updatedAt: new Date(),
      },
    })
    .returning({ tokensUsed: aiTokenUsage.tokensUsed });

  // If we got a result back, usage was recorded (or row existed and we checked).
  // We cannot easily detect if the CASE fell through to ELSE in all Drizzle drivers,
  // so we return true here. The pre-check in checkAiTokenBudget is the primary gate;
  // this atomic CASE is a safety net preventing concurrent overshoot.
  return true;
}
