/**
 * Onboarding Completion Check
 *
 * Checks if a tenant/user has completed the onboarding flow.
 * Used by the dashboard layout to redirect first-time users.
 */

import { db } from '@/drizzle/db';
import { onboardingProgress } from '@/drizzle/schema/infra';
import { eq, and } from 'drizzle-orm';

const ONBOARDING_COMPLETE_STEP = 'onboarding_complete';

/**
 * Check if user has completed onboarding for this tenant.
 * Returns true if onboarding is done, false if they need to go through it.
 */
export async function hasCompletedOnboarding(tenantId: string, userId: string): Promise<boolean> {
  try {
    const result = await db.query.onboardingProgress.findFirst({
      where: and(
        eq(onboardingProgress.tenantId, tenantId),
        eq(onboardingProgress.userId, userId),
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
        eq(onboardingProgress.userId, userId),
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
 * Mark onboarding as complete for a user in a tenant.
 */
export async function markOnboardingComplete(tenantId: string, userId: string): Promise<void> {
  try {
    await db.insert(onboardingProgress).values({
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
  } catch (err) {
    console.error('[Onboarding] Failed to mark complete:', err);
  }
}

/**
 * Record a specific onboarding step.
 */
export async function recordOnboardingStep(
  tenantId: string,
  userId: string,
  stepName: string
): Promise<void> {
  try {
    await db.insert(onboardingProgress).values({
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
  } catch (err) {
    console.error('[Onboarding] Failed to record step:', err);
  }
}
