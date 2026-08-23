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
  createdAt: Date;
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
  requestedBy: string
): Promise<ApprovalRequest> {
  const [result] = await db.transaction(async (tx) => {
    const [r] = await tx.insert(approvalRequests).values({
      tenantId,
      entityType,
      entityId,
      ruleId,
      status: 'pending',
      requestedBy,
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
export async function approveRequest(
  requestId: string,
  approvedBy: string
) {
  const [result] = await db.transaction(async (tx) => {
    const [r] = await tx.update(approvalRequests)
      .set({
        status: 'approved',
        approvedBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.status, 'pending')
      ))
      .returning();

    if (r) {
      await tx.insert(activities).values({
        tenantId: r.tenantId,
        userId: approvedBy,
        entityType: r.entityType,
        entityId: r.entityId,
        eventType: 'approval_approved',
        description: `Approval granted for ${r.entityType} ${r.entityId}`,
        metadata: { requestId },
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
    const [r] = await tx.update(approvalRequests)
      .set({
        status: 'rejected',
        rejectedBy,
        reason,
        updatedAt: new Date(),
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
        metadata: { requestId, reason },
      });
    }

    return [r];
  });

  return result;
}
