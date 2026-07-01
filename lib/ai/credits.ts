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

  // Auto-create if not exists (period rollover)
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
    }).returning();
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
 * Check if tenant has sufficient credits for an estimated call.
 * Returns true if call can proceed, false if blocked.
 */
export async function checkCredits(
  tenantId: string,
  estimatedTokens: number = 500,
): Promise<{ allowed: boolean; balance: CreditBalance; reason?: string }> {
  const balance = await getCreditBalance(tenantId);

  // If status is suspended, block all calls
  if (balance.status === 'suspended') {
    return { allowed: false, balance, reason: 'Account suspended by administrator' };
  }

  // If exhausted and hard cap enabled, block
  if (balance.status === 'exhausted' && balance.hardCapEnabled) {
    return { allowed: false, balance, reason: 'Credit balance exhausted. Contact administrator to allocate more tokens.' };
  }

  // Check remaining tokens
  if (balance.hardCapEnabled && balance.remainingTokens < estimatedTokens) {
    return {
      allowed: false,
      balance,
      reason: `Insufficient credits. Remaining: ${balance.remainingTokens.toLocaleString()} tokens, estimated needed: ${estimatedTokens.toLocaleString()}`,
    };
  }

  // Check cost cap
  if (balance.hardCapEnabled && balance.remainingCostCents <= 0 && balance.allocatedCostCents > 0) {
    return { allowed: false, balance, reason: 'Cost budget exhausted' };
  }

  return { allowed: true, balance };
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
}): Promise<CreditDeduction> {
  const period = getCurrentPeriod();
  const tokensUsed = params.tokensIn + params.tokensOut;

  try {
    // Atomic update: deduct from balance
    const [_updated] = await db
      .update(tenantAiCredits)
      .set({
        usedTokens: sql`${tenantAiCredits.usedTokens} + ${tokensUsed}`,
        usedCostCents: sql`${tenantAiCredits.usedCostCents} + ${params.costCents}`,
        status: sql`CASE 
          WHEN ${tenantAiCredits.allocatedTokens} - (${tenantAiCredits.usedTokens} + ${tokensUsed}) <= 0 THEN 'exhausted'
          ELSE 'active'
        END`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(tenantAiCredits.tenantId, params.tenantId),
        eq(tenantAiCredits.billingPeriod, period),
      ))
      .returning();

    // Get updated balance
    const balance = await getCreditBalance(params.tenantId);

    // Log to ledger
    await db.insert(aiCreditsLedger).values({
      tenantId: params.tenantId,
      userId: params.userId,
      action: params.action,
      provider: params.provider,
      model: params.model,
      tokensIn: params.tokensIn,
      tokensOut: params.tokensOut,
      tokensUsed,
      costCents: params.costCents,
      balanceAfterTokens: balance.remainingTokens,
      balanceAfterCostCents: balance.remainingCostCents,
      activityId: params.activityId,
      billingPeriod: period,
    });

    return { success: true, balanceAfter: balance };
  } catch (err) {
    console.error('[ai credits] deduction failed:', (err as Error).message);
    const balance = await getCreditBalance(params.tenantId);
    return { success: false, balanceAfter: balance, error: (err as Error).message };
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
        status: 'active',
        allocationNotes: params.notes,
        allocatedBy: params.allocatedBy,
        setBy: params.allocatedBy,
        updatedAt: new Date(),
      },
    });

  return getCreditBalance(params.tenantId);
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
        sql`${aiActivity.createdAt} >= ${period}-01::date`,
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
