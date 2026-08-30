/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { approvalRequests } from '@/drizzle/schema/core';
import { activities } from '@/drizzle/schema/infra';
import { eq, and } from 'drizzle-orm';

export interface ApprovalRule {
  id: string;
  tenantId: string;
  entityType: string;
  conditionField: string;
  conditionOperator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  conditionValue: string | number;
  approverRoleSlug: string;
  autoApproveRoles: string[];
}

/**
 * One step in a multi-step approval chain (#1632). Stored in
 * approval_requests.steps as an ordered array.
 */
export interface ApprovalStep {
  order: number;
  /** Role slug expected to act on this step (informational / for notifications). */
  approverRole?: string;
  status: 'pending' | 'approved' | 'rejected';
  actedBy?: string | null;
  actedAt?: string | null;
  reason?: string | null;
}

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  ruleId: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  approvedBy: string | null;
  rejectedBy: string | null;
  reason: string | null;
  steps: ApprovalStep[];
  currentStep: number;
  createdAt: Date;
}

/**
 * Normalize a raw `steps` jsonb value into a sorted ApprovalStep[]. Tolerates
 * legacy rows (null/empty) by returning [].
 */
function normalizeSteps(raw: unknown): ApprovalStep[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ApprovalStep[])
    .filter((s) => s && typeof s.order === 'number')
    .sort((a, b) => a.order - b.order);
}

/**
 * Evaluate whether an entity change requires approval based on rules.
 * Returns the first matching rule, or null if no approval needed.
 */
export function checkNeedsApproval(
  rules: ApprovalRule[],
  entityType: string,
  entityData: Record<string, unknown>
): ApprovalRule | null {
  for (const rule of rules) {
    if (rule.entityType !== entityType) continue;

    const fieldValue = entityData[rule.conditionField];
    if (fieldValue === undefined || fieldValue === null) continue;

    const numericFieldValue = typeof fieldValue === 'number' ? fieldValue : Number(fieldValue);
    const numericConditionValue = typeof rule.conditionValue === 'number'
      ? rule.conditionValue
      : Number(rule.conditionValue);

    if (isNaN(numericFieldValue) || isNaN(numericConditionValue)) {
      // String comparison for non-numeric values
      const strField = String(fieldValue);
      const strCondition = String(rule.conditionValue);

      if (rule.conditionOperator === '==' && strField === strCondition) return rule;
      if (rule.conditionOperator === '!=' && strField !== strCondition) return rule;
      continue;
    }

    let matches = false;
    switch (rule.conditionOperator) {
      case '>': matches = numericFieldValue > numericConditionValue; break;
      case '<': matches = numericFieldValue < numericConditionValue; break;
      case '>=': matches = numericFieldValue >= numericConditionValue; break;
      case '<=': matches = numericFieldValue <= numericConditionValue; break;
      case '==': matches = numericFieldValue === numericConditionValue; break;
      case '!=': matches = numericFieldValue !== numericConditionValue; break;
    }

    if (matches) return rule;
  }

  return null;
}

/**
 * Create a new approval request
 */
export async function requestApproval(
  tenantId: string,
  entityType: string,
  entityId: string,
  ruleId: string,
  requestedBy: string,
  /**
   * Optional ordered approval chain (#1632). Pass approver role slugs in the
   * order they must approve (e.g. ['manager','finance','vp']). Omitting this
   * (or passing []) creates a legacy single-stage request.
   */
  chainRoles?: string[]
): Promise<ApprovalRequest> {
  const steps: ApprovalStep[] = (chainRoles ?? [])
    .filter((role) => typeof role === 'string' && role.trim())
    .map((role, i) => ({
      order: i + 1,
      approverRole: role,
      status: 'pending' as const,
      actedBy: null,
      actedAt: null,
      reason: null,
    }));

  const [result] = await db.transaction(async (tx) => {
    const [r] = await tx.insert(approvalRequests).values({
      tenantId,
      entityType,
      entityId,
      ruleId,
      status: 'pending',
      requestedBy,
      steps,
      currentStep: 1,
    }).returning();

    await tx.insert(activities).values({
      tenantId,
      userId: requestedBy,
      entityType,
      entityId,
      eventType: 'approval_requested',
      description: `Approval requested for ${entityType} ${entityId}`,
      metadata: { ruleId },
    });

    return [r];
  });

  return result as unknown as ApprovalRequest;
}

/**
 * Approve a pending request
 */
/**
 * Approve the current step of a pending request (#1632).
 *
 * - Legacy request (no steps): approving finalizes it to `approved`.
 * - Multi-step chain: marks the current step approved and advances to the next
 *   step; the request stays `pending` until the FINAL step is approved, at which
 *   point it flips to `approved`.
 *
 * Returns the updated row, or an `{ advanced }` shaped result the caller can use
 * to tell "advanced to next step" from "fully approved".
 */
export async function approveRequest(
  requestId: string,
  approvedBy: string
) {
  const [result] = await db.transaction(async (tx) => {
    // Read the row (locked by the surrounding update) to inspect its chain.
    const [existing] = await tx.select()
      .from(approvalRequests)
      .where(and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.status, 'pending'),
      ))
      .limit(1);

    if (!existing) return [undefined];

    const steps = normalizeSteps(existing.steps);
    const now = new Date();

    // Legacy / single-stage: no chain defined -> finalize immediately.
    if (steps.length === 0) {
      const [r] = await tx.update(approvalRequests)
        .set({ status: 'approved', approvedBy, updatedAt: now })
        .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, 'pending')))
        .returning();

      if (r) {
        await tx.insert(activities).values({
          tenantId: r.tenantId, userId: approvedBy,
          entityType: r.entityType, entityId: r.entityId,
          eventType: 'approval_approved',
          description: `Approval granted for ${r.entityType} ${r.entityId}`,
          metadata: { requestId },
        });
      }
      return [r];
    }

    // Multi-step: mark the current step approved.
    const idx = Math.max(0, Math.min(existing.currentStep - 1, steps.length - 1));
    steps[idx] = { ...steps[idx]!, status: 'approved', actedBy: approvedBy, actedAt: now.toISOString() };

    const isFinalStep = idx >= steps.length - 1;
    const nextStep = isFinalStep ? existing.currentStep : existing.currentStep + 1;

    const [r] = await tx.update(approvalRequests)
      .set({
        steps,
        currentStep: nextStep,
        // Only flip the whole request to approved on the FINAL step.
        ...(isFinalStep ? { status: 'approved', approvedBy } : {}),
        updatedAt: now,
      })
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, 'pending')))
      .returning();

    if (r) {
      await tx.insert(activities).values({
        tenantId: r.tenantId, userId: approvedBy,
        entityType: r.entityType, entityId: r.entityId,
        eventType: isFinalStep ? 'approval_approved' : 'approval_step_approved',
        description: isFinalStep
          ? `Final approval granted for ${r.entityType} ${r.entityId}`
          : `Approval step ${idx + 1}/${steps.length} granted for ${r.entityType} ${r.entityId}`,
        metadata: { requestId, step: idx + 1, totalSteps: steps.length },
      });
    }

    return [r];
  });

  return result;
}

/**
 * Reject a pending request
 */
export async function rejectRequest(
  requestId: string,
  rejectedBy: string,
  reason: string
) {
  const [result] = await db.transaction(async (tx) => {
    const [existing] = await tx.select()
      .from(approvalRequests)
      .where(and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.status, 'pending'),
      ))
      .limit(1);

    if (!existing) return [undefined];

    const now = new Date();
    const steps = normalizeSteps(existing.steps);
    // #1632: a rejection at ANY step rejects the whole request. Record the
    // rejection on the current step so the chain history reflects who stopped it.
    if (steps.length > 0) {
      const idx = Math.max(0, Math.min(existing.currentStep - 1, steps.length - 1));
      steps[idx] = { ...steps[idx]!, status: 'rejected', actedBy: rejectedBy, actedAt: now.toISOString(), reason };
    }

    const [r] = await tx.update(approvalRequests)
      .set({
        status: 'rejected',
        rejectedBy,
        reason,
        ...(steps.length > 0 ? { steps } : {}),
        updatedAt: now,
      })
      .where(and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.status, 'pending')
      ))
      .returning();

    if (r) {
      await tx.insert(activities).values({
        tenantId: r.tenantId,
        userId: rejectedBy,
        entityType: r.entityType,
        entityId: r.entityId,
        eventType: 'approval_rejected',
        description: `Approval rejected for ${r.entityType} ${r.entityId}: ${reason}`,
        metadata: { requestId, reason, step: steps.length > 0 ? existing.currentStep : undefined },
      });
    }

    return [r];
  });

  return result;
}
