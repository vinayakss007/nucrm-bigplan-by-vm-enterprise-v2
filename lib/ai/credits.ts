/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * AI Credits Management
 *
 * Two offering types for AI usage:
 *   1. Centralized: Super admin allocates token/credit budgets to tenants.
 *      Users consume from this pool. Usage tracked per tenant.
 *   2. Personal: Users add their own API keys. Tracked via ai_activity only.
 *
 * This module handles centralized credit checking, deduction, and ledger logging.
 */
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { tenantAiCredits, aiCreditsLedger, aiProviderSecrets, aiActivity } from '@/drizzle/schema/ai';
import { tenants } from '@/drizzle/schema/core';
import { and, eq, sql, desc } from 'drizzle-orm';

export interface CreditBalance {
  allocatedTokens: number;
  usedTokens: number;
  remainingTokens: number;
  allocatedCostCents: number;
  usedCostCents: number;
  remainingCostCents: number;
  hardCapEnabled: boolean;
  softCapPct: number;
  status: string;
}

export interface CreditDeduction {
  success: boolean;
  balanceAfter: CreditBalance;
  error?: string;
}

/**
 * Get current billing period in YYYY-MM format.
 */
function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Check if a tenant has centralized credits enabled for a provider.
 */
export async function isCentralizedProvider(
  tenantId: string,
  provider: string,
): Promise<boolean> {
  const secret = await db.query.aiProviderSecrets.findFirst({
    where: and(
      eq(aiProviderSecrets.tenantId, tenantId),
      eq(aiProviderSecrets.provider, provider),
      eq(aiProviderSecrets.isCentralized, true),
    ),
  });
  return !!secret;
}

/**
 * Get or create credit balance for a tenant in the current period.
 */
export async function getCreditBalance(tenantId: string): Promise<CreditBalance> {
  const period = getCurrentPeriod();

  let credits = await db.query.tenantAiCredits.findFirst({
    where: and(
      eq(tenantAiCredits.tenantId, tenantId),
      eq(tenantAiCredits.billingPeriod, period),
    ),
  });

  // Auto-create if not exists (period rollover). #3081: the bare insert raced
  // the tenant_id_billing_period_key unique index — N concurrent first calls
  // of a month turned the losers into raw 23505s on an AI request.
  if (!credits) {
    [credits] = await db.insert(tenantAiCredits).values({
      tenantId,
      allocatedTokens: 0,
      usedTokens: 0,
      allocatedCostCents: 0,
      usedCostCents: 0,
      billingPeriod: period,
      hardCapEnabled: true,
      softCapPct: 80,
      status: 'active',
    }).onConflictDoNothing().returning();
    if (!credits) {
      credits = await db.query.tenantAiCredits.findFirst({
        where: and(
          eq(tenantAiCredits.tenantId, tenantId),
          eq(tenantAiCredits.billingPeriod, period),
        ),
      });
    }
  }

  return {
    allocatedTokens: credits?.allocatedTokens ?? 0,
    usedTokens: credits?.usedTokens ?? 0,
    remainingTokens: (credits?.allocatedTokens ?? 0) - (credits?.usedTokens ?? 0),
    allocatedCostCents: credits?.allocatedCostCents ?? 0,
    usedCostCents: credits?.usedCostCents ?? 0,
    remainingCostCents: (credits?.allocatedCostCents ?? 0) - (credits?.usedCostCents ?? 0),
    hardCapEnabled: credits?.hardCapEnabled ?? true,
    softCapPct: credits?.softCapPct ?? 80,
    status: credits?.status ?? 'active',
  };
}

/**
 * #3359: the old gate was `checkCredits` — a bare read. N concurrent
 * admissions against the same snapshot all passed and all settled later via
 * `deductCredits`, so a hard-capped tenant could overspend the cap by the
 * burst width. This is the admission entry point now: with a hard cap the
 * estimate is CLAIMED atomically — `allocated - used >= est` rides in the
 * UPDATE's WHERE, which Postgres re-evaluates under the row lock — and the
 * caller must settle or release it. Without a hard cap nothing is reserved
 * (`reserved: 0`) and the read-only gates still apply.
 */
export async function reserveCredits(
  tenantId: string,
  estimatedTokens: number = 500,
): Promise<{ allowed: boolean; reserved: number; balance: CreditBalance; reason?: string }> {
  const period = getCurrentPeriod();
  const balance = await getCreditBalance(tenantId);

  if (balance.status === 'suspended') {
    return { allowed: false, reserved: 0, balance, reason: 'Account suspended by administrator' };
  }
  if (balance.status === 'exhausted' && balance.hardCapEnabled) {
    return { allowed: false, reserved: 0, balance, reason: 'Credit balance exhausted. Contact administrator to allocate more tokens.' };
  }
  if (balance.hardCapEnabled && balance.remainingCostCents <= 0 && balance.allocatedCostCents > 0) {
    return { allowed: false, reserved: 0, balance, reason: 'Cost budget exhausted' };
  }
  if (!balance.hardCapEnabled) {
    return { allowed: true, reserved: 0, balance };
  }

  const [claimed] = await db
    .update(tenantAiCredits)
    .set({
      usedTokens: sql`${tenantAiCredits.usedTokens} + ${estimatedTokens}`,
      status: sql`CASE
        WHEN ${tenantAiCredits.status} = 'suspended' THEN 'suspended'
        WHEN ${tenantAiCredits.allocatedTokens} - (${tenantAiCredits.usedTokens} + ${estimatedTokens}) <= 0 THEN 'exhausted'
        ELSE 'active'
      END`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(tenantAiCredits.tenantId, tenantId),
      eq(tenantAiCredits.billingPeriod, period),
      sql`${tenantAiCredits.allocatedTokens} - ${tenantAiCredits.usedTokens} >= ${estimatedTokens}`,
    ))
    .returning({ id: tenantAiCredits.id });

  if (!claimed) {
    return {
      allowed: false,
      reserved: 0,
      balance,
      reason: `Insufficient credits. Remaining: ${balance.remainingTokens.toLocaleString()} tokens, estimated needed: ${estimatedTokens.toLocaleString()}`,
    };
  }

  return { allowed: true, reserved: estimatedTokens, balance };
}

/**
 * #3359: give an unconsumed reservation back. Runs on every `chat()` exit that
 * does not settle through `deductCredits` (provider chain failed, the success
 * came from a non-centralized provider, the settle transaction rolled back).
 * Best-effort by design: a failed release under-counts nothing that was
 * actually spent — it only leaves quota clamped until the next settle, whose
 * status CASE re-derives from the true `used` figure.
 */
export async function releaseCredits(tenantId: string, reserved: number): Promise<void> {
  if (reserved <= 0) return;
  const period = getCurrentPeriod();
  try {
    await db
      .update(tenantAiCredits)
      .set({
        usedTokens: sql`${tenantAiCredits.usedTokens} - ${reserved}`,
        status: sql`CASE
          WHEN ${tenantAiCredits.status} = 'suspended' THEN 'suspended'
          WHEN ${tenantAiCredits.allocatedTokens} - (${tenantAiCredits.usedTokens} - ${reserved}) <= 0 THEN 'exhausted'
          ELSE 'active'
        END`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(tenantAiCredits.tenantId, tenantId),
        eq(tenantAiCredits.billingPeriod, period),
      ));
  } catch (err) {
    await logError({ error: err, context: 'ai-credits: releaseCredits' });
  }
}

/**
 * Deduct credits after a successful AI call.
 * Writes to ledger and updates tenant balance atomically.
 */
export async function deductCredits(params: {
  tenantId: string;
  userId: string | null;
  action: string;
  provider: string;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  activityId: string | null;
  /**
   * #3359: tokens `reserveCredits` already added to `usedTokens` for this
   * call. The balance settles `used + actual - reserved`; the ledger still
   * records the true usage. Omit (or 0) for callers without a reservation.
   */
  reservedTokens?: number;
}): Promise<CreditDeduction> {
  const period = getCurrentPeriod();
  const tokensUsed = params.tokensIn + params.tokensOut;
  // The reservation is reconciled as a delta: actual < estimate nets the
  // balance back down by the unused headroom, actual > estimate bills the
  // overshoot. Only negatives from bad input are clamped.
  const reserved = Math.max(0, params.reservedTokens ?? 0);
  const delta = tokensUsed - reserved;

  try {
    const balance = await db.transaction(async (tx) => {
      // Deduct from balance
      await tx
        .update(tenantAiCredits)
        .set({
          usedTokens: sql`${tenantAiCredits.usedTokens} + ${delta}`,
          usedCostCents: sql`${tenantAiCredits.usedCostCents} + ${params.costCents}`,
          status: sql`CASE 
            WHEN ${tenantAiCredits.status} = 'suspended' THEN 'suspended'
            WHEN ${tenantAiCredits.allocatedTokens} - (${tenantAiCredits.usedTokens} + ${delta}) <= 0 THEN 'exhausted'
            ELSE 'active'
          END`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(tenantAiCredits.tenantId, params.tenantId),
          eq(tenantAiCredits.billingPeriod, period),
        ));

      // Read back updated balance
      const [updated] = await tx
        .select()
        .from(tenantAiCredits)
        .where(and(
          eq(tenantAiCredits.tenantId, params.tenantId),
          eq(tenantAiCredits.billingPeriod, period),
        ))
        .limit(1);

      const b = updated!;
      const bal = {
        allocatedTokens: b.allocatedTokens,
        usedTokens: b.usedTokens,
        remainingTokens: b.allocatedTokens - b.usedTokens,
        allocatedCostCents: b.allocatedCostCents,
        usedCostCents: b.usedCostCents,
        remainingCostCents: b.allocatedCostCents - b.usedCostCents,
        hardCapEnabled: b.hardCapEnabled,
        softCapPct: b.softCapPct ?? 80,
        status: b.status,
      };

      // Log to ledger
      await tx.insert(aiCreditsLedger).values({
        tenantId: params.tenantId,
        userId: params.userId,
        action: params.action,
        provider: params.provider,
        model: params.model,
        tokensIn: params.tokensIn,
        tokensOut: params.tokensOut,
        tokensUsed,
        costCents: params.costCents,
        balanceAfterTokens: bal.remainingTokens,
        balanceAfterCostCents: bal.remainingCostCents,
        activityId: params.activityId,
        billingPeriod: period,
      });

      return bal;
    });

    return { success: true, balanceAfter: balance };
  } catch (err) {
    await logError({ error: err, context: 'ai-credits: deductCredits' });
    try {
      const balance = await getCreditBalance(params.tenantId);
      return { success: false, balanceAfter: balance, error: (err as Error).message };
    } catch {
      return { success: false, balanceAfter: {} as CreditBalance, error: (err as Error).message };
    }
  }
}

/**
 * Allocate credits to a tenant (super admin action).
 * Adds to existing allocation for the current period.
 */
export async function allocateCredits(params: {
  tenantId: string;
  allocatedBy: string;
  tokens: number;
  costCents?: number;
  hardCapEnabled?: boolean;
  softCapPct?: number;
  notes?: string;
}): Promise<CreditBalance> {
  const period = getCurrentPeriod();

  await db
    .insert(tenantAiCredits)
    .values({
      tenantId: params.tenantId,
      allocatedTokens: params.tokens,
      allocatedCostCents: params.costCents ?? 0,
      billingPeriod: period,
      hardCapEnabled: params.hardCapEnabled ?? true,
      softCapPct: params.softCapPct ?? 80,
      status: 'active',
      allocationNotes: params.notes,
      allocatedBy: params.allocatedBy,
      setBy: params.allocatedBy,
    })
    .onConflictDoUpdate({
      target: [tenantAiCredits.tenantId, tenantAiCredits.billingPeriod],
      set: {
        allocatedTokens: sql`${tenantAiCredits.allocatedTokens} + ${params.tokens}`,
        allocatedCostCents: sql`${tenantAiCredits.allocatedCostCents} + ${params.costCents ?? 0}`,
        hardCapEnabled: params.hardCapEnabled ?? true,
        softCapPct: params.softCapPct ?? 80,
        // #3081: topping up an exhausted pool re-activates it, but a
        // suspension is an admin enforcement — only `reactivate` clears it.
        status: sql`CASE WHEN ${tenantAiCredits.status} = 'suspended' THEN 'suspended' ELSE 'active' END`,
        allocationNotes: params.notes,
        allocatedBy: params.allocatedBy,
        setBy: params.allocatedBy,
        updatedAt: new Date(),
      },
    });

  return getCreditBalance(params.tenantId);
}

/**
 * #3081: set the enforcement status for the CURRENT period, creating the
 * row if none exists yet. The superadmin suspend used to be a bare UPDATE —
 * on a fresh billing period there is no row, zero rows changed, and the
 * route still answered success while the tenant's next AI call auto-created
 * an 'active' row. An upsert makes the intent unconditional.
 */
export async function setCreditStatus(
  tenantId: string,
  status: 'active' | 'suspended',
): Promise<void> {
  const period = getCurrentPeriod();
  await db.insert(tenantAiCredits).values({
    tenantId,
    allocatedTokens: 0,
    usedTokens: 0,
    allocatedCostCents: 0,
    usedCostCents: 0,
    billingPeriod: period,
    hardCapEnabled: true,
    softCapPct: 80,
    status,
  }).onConflictDoUpdate({
    target: [tenantAiCredits.tenantId, tenantAiCredits.billingPeriod],
    set: { status, updatedAt: new Date() },
  });
}

/**
 * Get usage history for a tenant (from ledger).
 */
export async function getCreditHistory(
  tenantId: string,
  limit: number = 50,
): Promise<Array<{
  id: string;
  action: string;
  provider: string;
  model: string | null;
  tokensUsed: number;
  costCents: number;
  balanceAfterTokens: number | null;
  createdAt: Date;
}>> {
  return db
    .select({
      id: aiCreditsLedger.id,
      action: aiCreditsLedger.action,
      provider: aiCreditsLedger.provider,
      model: aiCreditsLedger.model,
      tokensUsed: aiCreditsLedger.tokensUsed,
      costCents: aiCreditsLedger.costCents,
      balanceAfterTokens: aiCreditsLedger.balanceAfterTokens,
      createdAt: aiCreditsLedger.createdAt,
    })
    .from(aiCreditsLedger)
    .where(eq(aiCreditsLedger.tenantId, tenantId))
    .orderBy(desc(aiCreditsLedger.createdAt))
    .limit(limit);
}

/**
 * Get aggregated usage across all tenants (for super admin dashboard).
 */
export async function getAggregatedUsage(): Promise<Array<{
  tenantId: string;
  tenantName: string | null;
  allocatedTokens: number;
  usedTokens: number;
  remainingTokens: number;
  usedCostCents: number;
  totalAiCalls: number;
  successRate: number;
}>> {
  const period = getCurrentPeriod();
  // Build the first-of-month date as a single JS string so the ::date cast
  // applies to the whole bound parameter. Previously the template
  // `${period}-01::date` bound only the `YYYY-MM` string as a param, turning
  // `-01::date` into arithmetic on the param rather than a `'YYYY-MM-01'::date`
  // literal.
  const periodStart = `${period}-01`;

  const results = await db
    .select({
      tenantId: tenantAiCredits.tenantId,
      allocatedTokens: tenantAiCredits.allocatedTokens,
      usedTokens: tenantAiCredits.usedTokens,
      usedCostCents: tenantAiCredits.usedCostCents,
    })
    .from(tenantAiCredits)
    .where(eq(tenantAiCredits.billingPeriod, period))
    .orderBy(desc(tenantAiCredits.usedTokens));

  // Enrich with tenant names and activity stats
  const enriched = await Promise.all(results.map(async (r) => {
    // Get tenant name
    const tenant = await db.query.tenants?.findFirst({
      where: eq(tenants.id, r.tenantId),
      columns: { name: true },
    });

    // Get activity stats for this period
    const activityStats = await db
      .select({
        total: sql<number>`count(*)::int`,
        successful: sql<number>`count(*) filter (where status = 'success')::int`,
      })
      .from(aiActivity)
      .where(and(
        eq(aiActivity.tenantId, r.tenantId),
        sql`${aiActivity.createdAt} >= ${periodStart}::date`,
      ));

    const stats = activityStats[0];
    const totalCalls = stats?.total ?? 0;
    const successCalls = stats?.successful ?? 0;

    return {
      tenantId: r.tenantId,
      tenantName: tenant?.name ?? null,
      allocatedTokens: r.allocatedTokens,
      usedTokens: r.usedTokens,
      remainingTokens: r.allocatedTokens - r.usedTokens,
      usedCostCents: r.usedCostCents,
      totalAiCalls: totalCalls,
      successRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0,
    };
  }));

  return enriched;
}
