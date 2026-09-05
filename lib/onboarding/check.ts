/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Onboarding Completion Check
 *
 * Checks if a tenant/user has completed the onboarding flow.
 * Used by the dashboard layout to redirect first-time users.
 */

import { db } from '@/drizzle/db';
import type { DbClient } from '@/drizzle/db';
import { onboardingProgress } from '@/drizzle/schema/infra';
import { eq, and } from 'drizzle-orm';

/**
 * A Drizzle client that may be either the shared `db` singleton or a
 * transaction handle passed by a caller. Both expose the same query surface
 * used by the onboarding write helpers, so callers can thread a `tx` to make
 * several onboarding writes atomic.
 */
type DbOrTx = DbClient | Parameters<Parameters<DbClient['transaction']>[0]>[0];

const ONBOARDING_COMPLETE_STEP = 'onboarding_complete';

/**
 * Check if onboarding has been completed for this tenant.
 * Onboarding is a one-time-per-tenant operation — once ANY user completes it,
 * all users in that tenant skip the onboarding flow.
 */
export async function hasCompletedOnboarding(tenantId: string, _userId: string): Promise<boolean> {
  try {
    const result = await db.query.onboardingProgress.findFirst({
      where: and(
        eq(onboardingProgress.tenantId, tenantId),
        eq(onboardingProgress.stepName, ONBOARDING_COMPLETE_STEP),
        eq(onboardingProgress.isCompleted, true)
      ),
      columns: { id: true },
    });

    if (result) return true;

    // Fallback: check for legacy 'completed' step name
    const legacyResult = await db.query.onboardingProgress.findFirst({
      where: and(
        eq(onboardingProgress.tenantId, tenantId),
        eq(onboardingProgress.stepName, 'completed'),
        eq(onboardingProgress.isCompleted, true)
      ),
      columns: { id: true },
    });

    return !!legacyResult;
  } catch {
    return true;
  }
}

/**
 * Mark onboarding as complete for a tenant.
 *
 * NOTE: an earlier revision also wrote a sentinel row with
 * userId '__tenant__' for "tenant-wide" completion, but user_id is a
 * uuid FK to users(id), so that insert always 500s with
 * `invalid input syntax for type uuid: "__tenant__"` and rolls back the
 * whole onboarding transaction. It is also redundant: hasCompletedOnboarding()
 * matches on tenantId+stepName only, so the completing user's own row already
 * marks the tenant complete for everyone. Only the per-user row is written.
 *
 * Accepts an optional `tx` client so callers can make this write part of a
 * larger transaction (see POST /api/tenant/onboarding/complete). Any error is
 * propagated to the caller so the surrounding transaction can roll back —
 * previously the error was swallowed, which left onboarding state inconsistent.
 */
export async function markOnboardingComplete(
  tenantId: string,
  userId: string,
  tx: DbOrTx = db
): Promise<void> {
  // Per-user completion row. hasCompletedOnboarding() matches on
  // tenantId+stepName alone, so this single row marks the tenant complete
  // for every user (no sentinel row — user_id is a uuid FK).
  await tx.insert(onboardingProgress).values({
    tenantId,
    userId,
    stepName: ONBOARDING_COMPLETE_STEP,
    isCompleted: true,
    completedAt: new Date(),
  }).onConflictDoUpdate({
    target: [onboardingProgress.tenantId, onboardingProgress.userId, onboardingProgress.stepName],
    set: {
      isCompleted: true,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Record a specific onboarding step.
 *
 * Accepts an optional `tx` client so callers can make this write part of a
 * larger transaction. Errors propagate to the caller (no longer swallowed) so
 * a failed step write rolls back the surrounding onboarding transaction.
 */
export async function recordOnboardingStep(
  tenantId: string,
  userId: string,
  stepName: string,
  tx: DbOrTx = db
): Promise<void> {
  await tx.insert(onboardingProgress).values({
    tenantId,
    userId,
    stepName,
    isCompleted: true,
    completedAt: new Date(),
  }).onConflictDoUpdate({
    target: [onboardingProgress.tenantId, onboardingProgress.userId, onboardingProgress.stepName],
    set: {
      isCompleted: true,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}
