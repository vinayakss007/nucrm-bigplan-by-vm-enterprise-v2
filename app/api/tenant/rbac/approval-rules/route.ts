/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { approvalRules } from '@/drizzle/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { isUuid } from '@/lib/id';
import { withApiRoute } from '@/lib/api/with-api-route';

const MAX_ROWS = 500;
const OPERATORS = ['>', '<', '>=', '<=', '==', '!='] as const;

/**
 * #2597 A3. The stored columns mirror lib/rbac/approval-workflows.ts's
 * ApprovalRule so `checkNeedsApproval` can consume them directly later.
 * `name` and `isActive` are the operator-facing state the settings tab shows.
 */
const ruleFields = {
  name: z.string().min(1).max(200),
  entityType: z.string().min(1).max(100),
  conditionField: z.string().min(1).max(100),
  conditionOperator: z.enum(OPERATORS),
  // Numeric thresholds arrive as numbers from a JSON client; the column is
  // text because conditionValue may also be a string ('status', 'stage').
  conditionValue: z.union([z.string().min(1).max(200), z.number()]),
  approverRoleSlug: z.string().min(1).max(100),
  autoApproveRoles: z.array(z.string().min(1).max(100)).max(10),
  isActive: z.boolean(),
};

const createRuleSchema = z.object(ruleFields).extend({
  conditionOperator: ruleFields.conditionOperator.default('>='),
  autoApproveRoles: ruleFields.autoApproveRoles.default([]),
  isActive: ruleFields.isActive.default(true),
});

// No defaults here: a PATCH that omits a field must leave it untouched. Using
// createRuleSchema.partial() would inject the create defaults and silently
// overwrite a rule's operator/roles/active flag on an unrelated one-field edit.
const updateRuleSchema = z.object(ruleFields).partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

type RuleRow = {
  id: string;
  name: string;
  entityType: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  approverRoleSlug: string;
  autoApproveRoles: string[] | null;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/**
 * Return BOTH shapes: the flat columns a future producer evaluates, and the
 * `conditions`/`approvers` convenience keys the Approval Rules tab already
 * renders (app/tenant/settings/rbac/page.tsx). Extra keys are harmless to the
 * existing UI and avoid a second translation layer when A3's producer lands.
 */
function toApiRule(row: RuleRow) {
  const chain = row.autoApproveRoles ?? [];
  return {
    id: row.id,
    name: row.name,
    entityType: row.entityType,
    conditionField: row.conditionField,
    conditionOperator: row.conditionOperator,
    conditionValue: row.conditionValue,
    approverRoleSlug: row.approverRoleSlug,
    autoApproveRoles: chain,
    isActive: row.isActive,
    conditions: {
      field: row.conditionField,
      operator: row.conditionOperator,
      value: row.conditionValue,
    },
    approvers: [row.approverRoleSlug, ...chain],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const ruleColumns = {
  id: approvalRules.id,
  name: approvalRules.name,
  entityType: approvalRules.entityType,
  conditionField: approvalRules.conditionField,
  conditionOperator: approvalRules.conditionOperator,
  conditionValue: approvalRules.conditionValue,
  approverRoleSlug: approvalRules.approverRoleSlug,
  autoApproveRoles: approvalRules.autoApproveRoles,
  isActive: approvalRules.isActive,
  createdAt: approvalRules.createdAt,
  updatedAt: approvalRules.updatedAt,
};

/** Every mutation is admin-only and tenant-scoped; ids arrive as query params. */
function ruleId(req: NextRequest): string | NextResponse {
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: 'id must be a valid id' }, { status: 400 });
  }
  return id;
}

/**
 * GET /api/tenant/rbac/approval-rules — real rows, not the old hardcoded [].
 * 200 with [] still means "none configured", so the tab's empty state is honest.
 */
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rows = await db
      .select(ruleColumns)
      .from(approvalRules)
      .where(and(
        eq(approvalRules.tenantId, ctx.tenantId),
        isNull(approvalRules.deletedAt),
      ))
      .orderBy(desc(approvalRules.createdAt))
      .limit(MAX_ROWS);

    return NextResponse.json({ data: rows.map(toApiRule) });
  } catch (err: unknown) { return apiError(err); }
});

/** POST — create a rule from the settings tab / API. */
export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const rateLimited = await rateLimitMutating(req, 'rbac', 'post');
    if (rateLimited) return rateLimited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const validated = validateBody(createRuleSchema, await readJsonBody(req));
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [row] = await db.insert(approvalRules).values({
      tenantId: ctx.tenantId,
      name: v.name,
      entityType: v.entityType,
      conditionField: v.conditionField,
      conditionOperator: v.conditionOperator,
      conditionValue: String(v.conditionValue),
      approverRoleSlug: v.approverRoleSlug,
      autoApproveRoles: v.autoApproveRoles,
      isActive: v.isActive,
      createdBy: ctx.userId,
    }).returning(ruleColumns);

    if (!row) return NextResponse.json({ error: 'Could not create approval rule' }, { status: 500 });
    return NextResponse.json({ data: toApiRule(row) }, { status: 201 });
  } catch (err: unknown) { return apiError(err); }
});

/** PATCH ?id=<rule> — change any subset of a rule's fields. */
export const PATCH = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const id = ruleId(req);
    if (id instanceof NextResponse) return id;

    const validated = validateBody(updateRuleSchema, await readJsonBody(req));
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (v.name !== undefined) patch.name = v.name;
    if (v.entityType !== undefined) patch.entityType = v.entityType;
    if (v.conditionField !== undefined) patch.conditionField = v.conditionField;
    if (v.conditionOperator !== undefined) patch.conditionOperator = v.conditionOperator;
    if (v.conditionValue !== undefined) patch.conditionValue = String(v.conditionValue);
    if (v.approverRoleSlug !== undefined) patch.approverRoleSlug = v.approverRoleSlug;
    if (v.autoApproveRoles !== undefined) patch.autoApproveRoles = v.autoApproveRoles;
    if (v.isActive !== undefined) patch.isActive = v.isActive;

    const [row] = await db.update(approvalRules)
      .set(patch)
      .where(and(
        eq(approvalRules.id, id),
        eq(approvalRules.tenantId, ctx.tenantId),
        isNull(approvalRules.deletedAt),
      ))
      .returning(ruleColumns);

    if (!row) return NextResponse.json({ error: 'Approval rule not found' }, { status: 404 });
    return NextResponse.json({ data: toApiRule(row) });
  } catch (err: unknown) { return apiError(err); }
});

/** DELETE ?id=<rule> — tombstone, so a trashed name can be reused (0144). */
export const DELETE = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const id = ruleId(req);
    if (id instanceof NextResponse) return id;

    const [row] = await db.update(approvalRules)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(approvalRules.id, id),
        eq(approvalRules.tenantId, ctx.tenantId),
        isNull(approvalRules.deletedAt),
      ))
      .returning({ id: approvalRules.id });

    if (!row) return NextResponse.json({ error: 'Approval rule not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) { return apiError(err); }
});
