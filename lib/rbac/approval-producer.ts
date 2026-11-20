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
 * that never existed. This module is the producer for deal and contact PATCHes:
 *
 *   1. load the tenant's active rules and evaluate them with the same
 *      `checkNeedsApproval` the unit tests already exercise;
 *   2. stage the validated body on a new request instead of applying it;
 *   3. on FINAL approval, replay the staged fields with a compare-and-swap on
 *      the base `updatedAt`, so a concurrent edit is never overwritten.
 *
 * Other entities and stage transitions (which need their own side effects) are
 * explicitly out of scope, not silently ignored.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { activities, approvalRequests, approvalRules, companies, contacts, deals, leads, tasks, tenants } from '@/drizzle/schema';
import { checkNeedsApproval, requestApproval, type ApprovalRule } from '@/lib/rbac/approval-workflows';
import { updatedAtMs } from '@/lib/api/concurrency';
import type { AuthContext } from '@/lib/auth/middleware';

type EntityKey = 'deals' | 'contacts' | 'leads' | 'companies' | 'tasks';

const ENTITY_NAMES: Record<EntityKey, string[]> = {
  deals: ['deals', 'deal'],
  contacts: ['contacts', 'contact'],
  leads: ['leads', 'lead'],
  companies: ['companies', 'company'],
  tasks: ['tasks', 'task'],
};

/** Body keys the replay may apply, and their Drizzle columns. */
const ENTITY_FIELDS: Record<EntityKey, Record<string, string>> = {
  deals: {
    title: 'title', amount: 'amount', value: 'amount', close_date: 'closeDate',
    // A create needs the resolved stage id; PATCH staging rejects stage changes
    // before this allowlist is reached, so adding it does not widen replay.
    stage_id: 'stageId',
    contact_id: 'contactId', company_id: 'companyId', pipeline_id: 'pipelineId',
    assigned_to: 'assignedTo', metadata: 'metadata',
  },
  contacts: {
    first_name: 'firstName', last_name: 'lastName', email: 'email', phone: 'phone',
    job_title: 'jobTitle', title: 'jobTitle', company_id: 'companyId',
    assigned_to: 'assignedTo', lead_status: 'leadStatus', lead_source: 'leadSource',
    notes: 'notes', tags: 'tags', score: 'score', city: 'city', country: 'country',
    website: 'website', linkedin_url: 'linkedinUrl', twitter_url: 'twitterUrl',
    custom_fields: 'customFields',
  },
  leads: {
    first_name: 'firstName', last_name: 'lastName', email: 'email', phone: 'phone',
    company_id: 'companyId', assigned_to: 'assignedTo', lead_status: 'leadStatus',
    lead_source: 'leadSource', notes: 'notes', score: 'score', tags: 'tags',
  },
  companies: {
    name: 'name', domain: 'domain', industry: 'industry', size: 'companySize',
    annual_revenue: 'annualRevenue', description: 'description', notes: 'notes',
    website: 'website', phone: 'phone', billing_address: 'address', city: 'city',
    state: 'state', country: 'country', postal_code: 'postalCode',
    linkedin_url: 'linkedinUrl', twitter_url: 'twitterUrl', facebook_url: 'facebookUrl',
    tags: 'tags', custom_fields: 'customFields',
  },
  tasks: {
    title: 'title', description: 'description', due_date: 'dueDate', priority: 'priority',
    contact_id: 'contactId', deal_id: 'dealId', assigned_to: 'assignedTo',
    status: 'status', completed: 'completed',
  },
};

/** Columns stored as `date`/`timestamptz` in the replayed payloads. */
const DATE_COLUMNS = new Set(['closeDate', 'dueDate']);
/** Columns Drizzle types as `numeric` (string in, string out). */
const STRING_COLUMNS = new Set(['amount', 'annualRevenue']);

/** Changes that need their own side effects are rejected, never staged silently. */
const UNSUPPORTED_KEYS: Record<EntityKey, string[]> = {
  deals: ['stage_id', 'stage', 'stage_name'],
  contacts: [], leads: [], companies: [], tasks: [],
};

/** Tables keyed by (id, tenant_id, deleted_at, updated_at) for replay and CAS. */
const ENTITY_TABLES = {
  deals, contacts, leads, companies, tasks,
} as const;

type StagedBody = Record<string, unknown>;

export interface PendingData {
  /** Legacy staged PATCHes have no `kind` and are treated as updates. */
  kind?: 'update' | 'create';
  body: StagedBody;
  /** Only present for updates: the base row version used for the CAS. */
  baseUpdatedAt?: string;
}

function asPending(raw: unknown): PendingData | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PendingData>;
  if (!p.body || typeof p.body !== 'object') return null;
  const kind = p.kind === 'create' ? 'create' : 'update';
  if (kind === 'update' && typeof p.baseUpdatedAt !== 'string') return null;
  return { kind, body: p.body as StagedBody, baseUpdatedAt: p.baseUpdatedAt };
}

function normalizeEntity(entityType: string): EntityKey | null {
  for (const key of Object.keys(ENTITY_NAMES) as EntityKey[]) {
    if (ENTITY_NAMES[key].includes(entityType)) return key;
  }
  return null;
}

/** Load active rules and return the first one matching this proposed change. */
async function findMatchingApprovalRule(
  tenantId: string,
  entityType: EntityKey,
  entityData: Record<string, unknown>,
): Promise<ApprovalRule | null> {
  const rows = await db
    .select({
      id: approvalRules.id, tenantId: approvalRules.tenantId, entityType: approvalRules.entityType,
      conditionField: approvalRules.conditionField, conditionOperator: approvalRules.conditionOperator,
      conditionValue: approvalRules.conditionValue, approverRoleSlug: approvalRules.approverRoleSlug,
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
    id: r.id, tenantId: r.tenantId, entityType: r.entityType,
    conditionField: r.conditionField,
    conditionOperator: r.conditionOperator as ApprovalRule['conditionOperator'],
    conditionValue: r.conditionValue, approverRoleSlug: r.approverRoleSlug,
    autoApproveRoles: r.autoApproveRoles ?? [],
  }));
  // checkNeedsApproval filters on entityType itself; try every spelling so a
  // 'deal' rule also matches the deals route.
  for (const name of ENTITY_NAMES[entityType]) {
    const match = checkNeedsApproval(rules, name, entityData);
    if (match) return match;
  }
  return null;
}

export type StageResult =
  | { kind: 'none' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'conflict'; requestId: string }
  | { kind: 'staged'; requestId: string; currentStep: number };

/** Admins bypass approval: a tenant staffing role is what the chain names. */
async function stageEntityChange(
  ctx: AuthContext,
  entityType: EntityKey,
  entityId: string,
  entityData: Record<string, unknown>,
  body: StagedBody,
  baseUpdatedAt: Date | string,
): Promise<StageResult> {
  if (ctx.isAdmin || ctx.isSuperAdmin) return { kind: 'none' };
  const unsupported = UNSUPPORTED_KEYS[entityType].find((key) => body[key] !== undefined);
  if (unsupported) {
    return { kind: 'unsupported', reason: `${unsupported} changes cannot go through approval yet` };
  }

  const rule = await findMatchingApprovalRule(ctx.tenantId, entityType, entityData);
  if (!rule) return { kind: 'none' };

  const canonical = ENTITY_NAMES[entityType][0]!;
  const [pending] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(
      eq(approvalRequests.tenantId, ctx.tenantId),
      eq(approvalRequests.entityType, canonical),
      eq(approvalRequests.entityId, entityId),
      eq(approvalRequests.status, 'pending'),
      isNull(approvalRequests.deletedAt),
    ))
    .limit(1);
  if (pending) return { kind: 'conflict', requestId: pending.id };

  const chain = [rule.approverRoleSlug, ...rule.autoApproveRoles];
  const request = await requestApproval(
    ctx.tenantId, canonical, entityId, rule.id, ctx.userId, chain,
    { body, baseUpdatedAt: new Date(baseUpdatedAt).toISOString() } satisfies PendingData,
  );
  return { kind: 'staged', requestId: request.id, currentStep: request.currentStep };
}

/** Kept as the deal-facing API (tests and route pin this name). */
export function stageDealChange(
  ctx: AuthContext, dealId: string, entityData: Record<string, unknown>,
  body: StagedBody, baseUpdatedAt: Date | string,
): Promise<StageResult> {
  return stageEntityChange(ctx, 'deals', dealId, entityData, body, baseUpdatedAt);
}

function stageFor(entityType: EntityKey) {
  return (
    ctx: AuthContext, entityId: string, entityData: Record<string, unknown>,
    body: StagedBody, baseUpdatedAt: Date | string,
  ): Promise<StageResult> => stageEntityChange(ctx, entityType, entityId, entityData, body, baseUpdatedAt);
}

export const stageContactChange = stageFor('contacts');
export const stageLeadChange = stageFor('leads');
export const stageCompanyChange = stageFor('companies');
export const stageTaskChange = stageFor('tasks');

/** Route-facing wrapper: one call, one `NextResponse | null`. */
async function stagePatchResponse(
  ctx: AuthContext, entityType: EntityKey, entityId: string,
  entityData: Record<string, unknown>, body: StagedBody, baseUpdatedAt: Date | string,
): Promise<NextResponse | null> {
  const staged = await stageEntityChange(ctx, entityType, entityId, entityData, body, baseUpdatedAt);
  if (staged.kind === 'none') return null;
  if (staged.kind === 'unsupported') {
    return NextResponse.json({ error: staged.reason }, { status: 400 });
  }
  if (staged.kind === 'conflict') {
    return NextResponse.json({
      error: `An approval is already pending for this ${ENTITY_NAMES[entityType][0]!.replace(/s$/, '')}`,
      approval_id: staged.requestId,
    }, { status: 409 });
  }
  return NextResponse.json({
    ok: true, pending: true, approval_id: staged.requestId, current_step: staged.currentStep,
  }, { status: 202 });
}

export function stageDealPatchResponse(
  ctx: AuthContext, dealId: string, entityData: Record<string, unknown>,
  body: StagedBody, baseUpdatedAt: Date | string,
): Promise<NextResponse | null> {
  return stagePatchResponse(ctx, 'deals', dealId, entityData, body, baseUpdatedAt);
}

function patchResponseFor(entityType: EntityKey) {
  return (
    ctx: AuthContext, entityId: string, entityData: Record<string, unknown>,
    body: StagedBody, baseUpdatedAt: Date | string,
  ): Promise<NextResponse | null> => stagePatchResponse(ctx, entityType, entityId, entityData, body, baseUpdatedAt);
}

export const stageContactPatchResponse = patchResponseFor('contacts');
export const stageLeadPatchResponse = patchResponseFor('leads');
export const stageCompanyPatchResponse = patchResponseFor('companies');
export const stageTaskPatchResponse = patchResponseFor('tasks');

/**
 * #2597 POST staging. A create has no base row to CAS against, so the future
 * row's id is reserved here and stored on the approval request (whose
 * `entity_id` is NOT NULL). Nothing is written to the entity table until the
 * final approval replays the staged body.
 *
 * Only the core row is replayed (#2597 "core replay only"): no follow-up
 * tasks, notifications or webhooks fire from a staged create. Create-time
 * validation, dedup and quota admission still happen in the POST handler
 * before a request is staged; the deal quota counter is incremented on replay
 * so the tenant's usage stays accurate.
 */
async function stageEntityCreate(
  ctx: AuthContext,
  entityType: EntityKey,
  entityData: Record<string, unknown>,
  body: StagedBody,
): Promise<StageResult> {
  if (ctx.isAdmin || ctx.isSuperAdmin) return { kind: 'none' };

  const rule = await findMatchingApprovalRule(ctx.tenantId, entityType, entityData);
  if (!rule) return { kind: 'none' };

  const entityId = randomUUID();
  const canonical = ENTITY_NAMES[entityType][0]!;
  const chain = [rule.approverRoleSlug, ...rule.autoApproveRoles];
  const request = await requestApproval(
    ctx.tenantId, canonical, entityId, rule.id, ctx.userId, chain,
    { kind: 'create', body } satisfies PendingData,
  );
  return { kind: 'staged', requestId: request.id, currentStep: request.currentStep };
}

function createResponseFor(entityType: EntityKey) {
  return (
    ctx: AuthContext, entityData: Record<string, unknown>, body: StagedBody,
  ): Promise<NextResponse | null> => stageEntityCreate(ctx, entityType, entityData, body)
    .then((staged) => {
      if (staged.kind === 'none') return null;
      if (staged.kind === 'unsupported') {
        return NextResponse.json({ error: staged.reason }, { status: 400 });
      }
      if (staged.kind === 'conflict') {
        return NextResponse.json({
          error: `An approval is already pending for this ${ENTITY_NAMES[entityType][0]!.replace(/s$/, '')}`,
          approval_id: staged.requestId,
        }, { status: 409 });
      }
      return NextResponse.json({
        ok: true, pending: true, approval_id: staged.requestId, current_step: staged.currentStep,
      }, { status: 202 });
    });
}

export const stageDealCreateResponse = createResponseFor('deals');
export const stageContactCreateResponse = createResponseFor('contacts');
export const stageLeadCreateResponse = createResponseFor('leads');
export const stageCompanyCreateResponse = createResponseFor('companies');
export const stageTaskCreateResponse = createResponseFor('tasks');

/**
 * Companies PATCH only loads `updatedAt` inside the non-admin branch, so the
 * staging path needs its own read for the CAS base.
 */
export async function loadBaseUpdatedAt(
  entityType: EntityKey,
  entityId: string,
  tenantId: string,
): Promise<Date | null> {
  const table = ENTITY_TABLES[entityType];
  const [row] = await db.select({ updatedAt: table.updatedAt })
    .from(table)
    .where(and(eq(table.id, entityId), eq(table.tenantId, tenantId)))
    .limit(1);
  return row?.updatedAt ?? null;
}

export interface ApprovalLike {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  status: string;
  requestedBy?: string | null;
  pendingData: unknown;
}

function coerceField(column: string, value: unknown): unknown {
  if (DATE_COLUMNS.has(column)) return value ? new Date(value as string) : null;
  if (STRING_COLUMNS.has(column)) return value == null ? null : String(value);
  return value;
}

/** Replay a staged create with the id reserved when the request was made. */
async function applyStagedCreate(
  entity: EntityKey,
  request: ApprovalLike,
  pending: PendingData,
  approvedBy: string,
): Promise<{ applied: boolean; reason?: string }> {
  const values: Record<string, unknown> = {
    id: request.entityId,
    tenantId: request.tenantId,
    createdBy: request.requestedBy,
  };
  const fields = ENTITY_FIELDS[entity];
  for (const [key, value] of Object.entries(pending.body)) {
    const column = fields[key];
    if (!column) continue;
    values[column] = coerceField(column, value);
  }

  const table = ENTITY_TABLES[entity];
  // Idempotent: a double decision or a retry must not create a duplicate row.
  const [inserted] = await db.insert(table).values(values as (typeof table)['$inferInsert'])
    .onConflictDoNothing()
    .returning({ id: table.id });
  if (!inserted) return { applied: false, reason: 'already_applied' };

  // Deals quota is priced at staging time; replay must still count the row.
  if (entity === 'deals') {
    await db.update(tenants)
      .set({ currentDeals: sql`COALESCE(${tenants.currentDeals}, 0) + 1` })
      .where(eq(tenants.id, request.tenantId));
  }

  await db.insert(activities).values({
    tenantId: request.tenantId,
    userId: approvedBy,
    entityType: entity,
    entityId: request.entityId,
    eventType: 'approval_change_applied',
    description: `Approved ${ENTITY_NAMES[entity][0]!.replace(/s$/, '')} create applied to ${request.entityId}`,
    metadata: { requestId: request.id },
  });
  return { applied: true };
}

/**
 * Apply a staged change on FINAL approval. Returns `{applied:false}` for
 * decision-only requests, unsupported entities, intermediate chain steps, or a
 * stale base — never a silent success.
 */
export async function applyApprovedChange(
  request: ApprovalLike,
  approvedBy: string,
): Promise<{ applied: boolean; reason?: string }> {
  if (request.status !== 'approved') return { applied: false, reason: 'not_final' };
  const entity = normalizeEntity(request.entityType);
  if (!entity) return { applied: false, reason: 'unsupported_entity' };
  const pending = asPending(request.pendingData);
  if (!pending) return { applied: false, reason: 'no_staged_change' };
  if (pending.kind === 'create') return applyStagedCreate(entity, request, pending, approvedBy);

  const fields = ENTITY_FIELDS[entity];
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(pending.body)) {
    const column = fields[key];
    if (!column) continue;
    patch[column] = coerceField(column, value);
  }

  const table = ENTITY_TABLES[entity];
  const [updated] = await db
    .update(table)
    .set(patch)
    .where(and(
      // `entityId` names the row; both tables expose id/tenantId/deletedAt.
      eq(table.id, request.entityId),
      eq(table.tenantId, request.tenantId),
      isNull(table.deletedAt),
      updatedAtMs(table, pending.baseUpdatedAt!),
    ))
    .returning({ id: table.id });

  if (!updated) return { applied: false, reason: 'stale' };

  await db.insert(activities).values({
    tenantId: request.tenantId,
    userId: approvedBy,
    entityType: entity,
    entityId: request.entityId,
    eventType: 'approval_change_applied',
    description: `Approved ${ENTITY_NAMES[entity][0]!.replace(/s$/, '')} change applied to ${request.entityId}`,
    metadata: { requestId: request.id },
  });
  return { applied: true };
}
