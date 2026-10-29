/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3359 — the reservation half of AI credits.
 *
 * Split out of `lib/ai/credits.ts` because that file sits on the #1843 file-size
 * ratchet and the reserve-and-reconcile work had nowhere to grow. The balance
 * read (`getCreditBalance`), the gate (`checkCredits`) and the settlement
 * (`deductCredits`) stay put; `lib/ai/credits.ts` re-exports these two so every
 * existing `@/lib/ai/credits` import keeps working.
 */
import { db } from '@/drizzle/db';
import { tenantAiCredits } from '@/drizzle/schema/ai';
import { and, eq, sql } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';
import type { CreditBalance } from './credits';
import { checkCredits, getCurrentPeriod, getCreditBalance, toCreditBalance } from './credits';

export interface CreditReservation {
  allowed: boolean;
  balance: CreditBalance;
  /** Tokens held out of the balance by this admission; 0 when nothing was claimed. */
  reserved: number;
  reason?: string;
}

/**
 * #3359: admit a call by *claiming* the estimate, not by reading the balance.
 *
 * `checkCredits()` alone is a check-then-act: N concurrent `chat()` calls all
 * read `allocated - used >= estimate` off the same snapshot, all get admitted,
 * and every one of them settles — so the tenant overspends the hard cap by up
 * to N x the balance. Here the increment is the claim, and the predicate lives
 * in the UPDATE's WHERE, so Postgres re-checks it under the row lock and a
 * losing claim gets zero rows back.
 *
 * The caller MUST either settle the claim (`deductCredits({ reservedTokens })`)
 * or hand it back (`releaseCredits`) — see the non-settling paths in
 * `lib/ai/gateway.ts`.
 */
export async function reserveCredits(
  tenantId: string,
  estimatedTokens: number = 500,
): Promise<CreditReservation> {
  const gate = await checkCredits(tenantId, estimatedTokens);
  if (!gate.allowed) {
    return { allowed: false, balance: gate.balance, reserved: 0, reason: gate.reason };
  }
  // Nothing to claim when the cap is soft — the gate above already allowed it.
  if (!gate.balance.hardCapEnabled) {
    return { allowed: true, balance: gate.balance, reserved: 0 };
  }

  const period = getCurrentPeriod();
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
    .returning();

  if (!claimed) {
    // Someone else's claim landed first. Re-read only to word the refusal.
    const balance = await getCreditBalance(tenantId);
    return {
      allowed: false,
      balance,
      reserved: 0,
      reason: `Insufficient credits. Remaining: ${balance.remainingTokens.toLocaleString()} tokens, estimated needed: ${estimatedTokens.toLocaleString()}`,
    };
  }

  return { allowed: true, balance: toCreditBalance(claimed), reserved: estimatedTokens };
}

/**
 * #3359: give back a claim that never settled. Best-effort by design — the
 * caller is on its way to throwing the provider error, and a stuck release must
 * not replace it. The cost side is untouched: nothing was billed.
 */
export async function releaseCredits(
  tenantId: string,
  reservedTokens: number,
): Promise<void> {
  if (reservedTokens <= 0) return;

  const period = getCurrentPeriod();
  try {
    await db
      .update(tenantAiCredits)
      .set({
        usedTokens: sql`GREATEST(${tenantAiCredits.usedTokens} - ${reservedTokens}, 0)`,
        status: sql`CASE
          WHEN ${tenantAiCredits.status} = 'suspended' THEN 'suspended'
          WHEN ${tenantAiCredits.allocatedTokens} - GREATEST(${tenantAiCredits.usedTokens} - ${reservedTokens}, 0) <= 0 THEN 'exhausted'
          ELSE 'active'
        END`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(tenantAiCredits.tenantId, tenantId),
        eq(tenantAiCredits.billingPeriod, period),
      ));
  } catch (err) {
    await logError({ error: err, context: `ai-credits: releaseCredits tenant=${tenantId} reserved=${reservedTokens}` });
  }
}
