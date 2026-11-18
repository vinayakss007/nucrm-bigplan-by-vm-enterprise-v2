/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 A3 producer — the missing half of the approval inbox.
 *
 * `approval_requests` had a writer (`requestApproval`) but no caller, so no
 * request was ever created and the approve/reject endpoints worked on rows
 * that never existed. This module is the producer for deal PATCHes:
 *
 *   1. load the tenant's active rules and evaluate them with the same
 *      `checkNeedsApproval` the unit tests already exercise;
 *   2. stage the validated body on a new request instead of applying it;
 *   3. on FINAL approval, replay the staged fields with a compare-and-swap on
 *      the base `updatedAt`, so a concurrent edit is never overwritten.
 *
 * Deals are the first entity; other entities and stage transitions (which need
 * their own side effects) are explicitly out of scope, not silently ignored.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { activities, approvalRequests, approvalRules, deals } from '@/drizzle/schema';
import { checkNeedsApproval, requestApproval, type ApprovalRule } from '@/lib/rbac/approval-workflows';
import { updatedAtMs } from '@/lib/api/concurrency';
import type { AuthContext } from '@/lib/auth/middleware';

export const STAGED_ENTITY = 'deals';

/** The UI/route spell both singular and plural; accept both, as for fields. */
const ENTITY_NAMES = ['deals', 'deal'];

/** Body keys the replay is allowed to apply, and their Drizzle columns. */
const DEAL_FIELDS: Record<string, keyof typeof deals.$inferInsert> = {
  title: 'title',
  amount: 'amount',
  value: 'amount',
  close_date: 'closeDate',
  contact_id: 'contactId',
  company_id: 'companyId',
  pipeline_id: 'pipelineId',
  assigned_to: 'assignedTo',
  metadata: 'metadata',
};

const STAGE_KEYS = ['stage_id', 'stage', 'stage_name'];

type StagedBody = Record<string, unknown>;

export interface PendingData {
  body: StagedBody;
  baseUpdatedAt: string;
}

function asPending(raw: unknown): PendingData | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PendingData>;
  if (!p.body || typeof p.body !== 'object' || typeof p.baseUpdatedAt !== 'string') return null;
  return { body: p.body as StagedBody, baseUpdatedAt: p.baseUpdatedAt };
}

/** Load active rules and return the first one matching this proposed change. */
async function findMatchingApprovalRule(
  tenantId: string,
  entityType: string,
  entityData: Record<string, unknown>,
): Promise<ApprovalRule | null> {
  const rows = await db
    .select({
      id: approvalRules.id,
      tenantId: approvalRules.tenantId,
      entityType: approvalRules.entityType,
      conditionField: approvalRules.conditionField,
      conditionOperator: approvalRules.conditionOperator,
      conditionValue: approvalRules.conditionValue,
      approverRoleSlug: approvalRules.approverRoleSlug,
      autoApproveRoles: approvalRules.autoApproveRoles,
    })
    .from(approvalRules)
    .where(and(
      eq(approvalRules.tenantId, tenantId),
      eq(approvalRules.isActive, true),
      isNull(approvalRules.deletedAt),
    ))
    .limit(100);

  const rules: ApprovalRule[] = rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    entityType: r.entityType,
    conditionField: r.conditionField,
    conditionOperator: r.conditionOperator as ApprovalRule['conditionOperator'],
    conditionValue: r.conditionValue,
    approverRoleSlug: r.approverRoleSlug,
    autoApproveRoles: r.autoApproveRoles ?? [],
  }));
  // checkNeedsApproval filters on entityType itself; pass every candidate
  // spelling so a 'deal' rule also matches the deals route.
  return checkNeedsApproval(rules, entityType, entityData)
    ?? ENTITY_NAMES.slice(1).map((alt) => checkNeedsApproval(rules, alt, entityData)).find(Boolean)
    ?? null;
}

export type StageResult =
  | { kind: 'none' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'conflict'; requestId: string }
  | { kind: 'staged'; requestId: string; currentStep: number };

/**
 * Stage a rule-matched deal PATCH. Admin/superadmin writes bypass approval:
 * a tenant staffing role is what a rule's approver chain names.
 */
export async function stageDealChange(
  ctx: AuthContext,
  dealId: string,
  entityData: Record<string, unknown>,
  body: StagedBody,
  baseUpdatedAt: Date | string,
): Promise<StageResult> {
  if (ctx.isAdmin || ctx.isSuperAdmin) return { kind: 'none' };
  if (STAGE_KEYS.some((key) => body[key] !== undefined)) {
    return { kind: 'unsupported', reason: 'Stage transitions cannot go through approval yet' };
  }

  const rule = await findMatchingApprovalRule(ctx.tenantId, STAGED_ENTITY, entityData);
  if (!rule) return { kind: 'none' };

  const [pending] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(
      eq(approvalRequests.tenantId, ctx.tenantId),
      eq(approvalRequests.entityType, STAGED_ENTITY),
      eq(approvalRequests.entityId, dealId),
      eq(approvalRequests.status, 'pending'),
      isNull(approvalRequests.deletedAt),
    ))
    .limit(1);
  if (pending) return { kind: 'conflict', requestId: pending.id };

  const chain = [rule.approverRoleSlug, ...rule.autoApproveRoles];
  const request = await requestApproval(
    ctx.tenantId,
    STAGED_ENTITY,
    dealId,
    rule.id,
    ctx.userId,
    chain,
    { body, baseUpdatedAt: new Date(baseUpdatedAt).toISOString() } satisfies PendingData,
  );
  return { kind: 'staged', requestId: request.id, currentStep: request.currentStep };
}

/**
 * Route-facing wrapper: one call, one `NextResponse | null`. Keeping the four
 * response shapes here (rather than in the already-large deal route) also
 * keeps the filesize ratchet green.
 */
export async function stageDealPatchResponse(
  ctx: AuthContext,
  dealId: string,
  entityData: Record<string, unknown>,
  body: StagedBody,
  baseUpdatedAt: Date | string,
): Promise<NextResponse | null> {
  const staged = await stageDealChange(ctx, dealId, entityData, body, baseUpdatedAt);
  if (staged.kind === 'none') return null;
  if (staged.kind === 'unsupported') {
    return NextResponse.json({ error: staged.reason }, { status: 400 });
  }
  if (staged.kind === 'conflict') {
    return NextResponse.json({
      error: 'An approval is already pending for this deal',
      approval_id: staged.requestId,
    }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    pending: true,
    approval_id: staged.requestId,
    current_step: staged.currentStep,
  }, { status: 202 });
}

/** The subset of a staged row we hand back to the caller. */
export interface ApprovalLike {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  status: string;
  pendingData: unknown;
}

/**
 * Apply a staged change on FINAL approval. Returns `{applied:false}` for
 * decision-only requests, other entities, intermediate chain steps, or a
 * stale base — never a silent success.
 */
export async function applyApprovedChange(
  request: ApprovalLike,
  approvedBy: string,
): Promise<{ applied: boolean; reason?: string }> {
  if (request.status !== 'approved') return { applied: false, reason: 'not_final' };
  if (request.entityType !== STAGED_ENTITY && !ENTITY_NAMES.includes(request.entityType)) {
    return { applied: false, reason: 'unsupported_entity' };
  }
  const pending = asPending(request.pendingData);
  if (!pending) return { applied: false, reason: 'no_staged_change' };

  const patch: Partial<typeof deals.$inferInsert> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(pending.body)) {
    const column = DEAL_FIELDS[key];
    if (!column) continue;
    if (column === 'amount') {
      patch.amount = typeof value === 'number' ? String(value) : (value as string);
    } else if (column === 'closeDate') {
      patch.closeDate = value ? new Date(value as string) : null;
    } else {
      // The remaining staged fields are strings/jsonb; body shape is already
      // Zod-validated by the PATCH handler before staging.
      (patch as Record<string, unknown>)[column] = value;
    }
  }

  const [updated] = await db
    .update(deals)
    .set(patch)
    .where(and(
      eq(deals.id, request.entityId),
      eq(deals.tenantId, request.tenantId),
      isNull(deals.deletedAt),
      updatedAtMs(deals, pending.baseUpdatedAt),
    ))
    .returning({ id: deals.id });

  if (!updated) return { applied: false, reason: 'stale' };

  await db.insert(activities).values({
    tenantId: request.tenantId,
    userId: approvedBy,
    entityType: STAGED_ENTITY,
    entityId: request.entityId,
    eventType: 'approval_change_applied',
    description: `Approved deal change applied to ${request.entityId}`,
    metadata: { requestId: request.id },
  });
  return { applied: true };
}
