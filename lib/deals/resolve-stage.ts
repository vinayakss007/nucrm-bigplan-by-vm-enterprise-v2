/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Robust deal-stage resolution (#658 / HIGH #8).
 *
 * The deals API accepts a stage as any of three request fields:
 *   - `stage_id`   — a UUID (canonical)
 *   - `stage`      — a human name ("Won", "Proposal", …)  [legacy]
 *   - `stage_name` — a human name (frontend field)        [legacy]
 *
 * The previous inline resolution had several edge cases that failed silently:
 *   1. Name lookups used `ilike(name, rawName)` WITHOUT escaping LIKE
 *      metacharacters, so a name containing `%`/`_` (or a caller probing with
 *      wildcards) could resolve to the WRONG stage.
 *   2. Name lookups were scoped through `pipelines.tenantId` only; they never
 *      asserted the resolved stage belongs to the requested `pipeline_id`, and
 *      never validated an explicitly-supplied `stage_id` at all — so a caller
 *      could attach a deal to another tenant's stage or a stage from a
 *      different pipeline, producing an inconsistent record.
 *   3. `.limit(1)` silently picked one row when a tenant had multiple stages
 *      with the same name across pipelines (ambiguous), hiding the problem.
 *
 * This helper centralizes resolution for both POST (create) and PATCH (update)
 * so the rules are consistent and unit-testable. It ALWAYS validates that the
 * resolved stage belongs to the tenant and — when a pipeline is in play — to
 * that pipeline, returning a typed failure reason instead of resolving to the
 * wrong stage or throwing.
 */
import { and, eq, ilike, sql } from 'drizzle-orm';
import { dealStages, pipelines } from '@/drizzle/schema';
import type { DbClient } from '@/drizzle/db';
import { escapeLike } from '@/lib/api/sanitize-like';

/** Minimal executor shape shared by the pool `db` and a `tx` inside a transaction. */
export type StageResolverExecutor = Pick<DbClient, 'select'>;

export type ResolveStageInput = {
  /** Explicit stage UUID (may be '' / null / undefined when unset). */
  stageId?: string | null;
  /** Stage name from the legacy `stage` or `stage_name` request fields. */
  stageName?: string | null;
  /** Optional pipeline UUID the deal is (being) attached to. */
  pipelineId?: string | null;
  /** Tenant the request is scoped to. */
  tenantId: string;
};

export type ResolveStageFailure =
  | 'missing'          // neither a stage_id nor a resolvable name was supplied
  | 'not_found'        // supplied stage_id / name did not match any stage
  | 'ambiguous'        // name matched multiple stages (pipeline_id disambiguates)
  | 'pipeline_mismatch'; // stage exists but belongs to a different pipeline

export type ResolveStageResult =
  | {
      ok: true;
      /** Resolved, validated stage UUID. */
      stageId: string;
      /** Canonical stage name (for audit/notification labels + won detection). */
      stageName: string;
      /** The pipeline the resolved stage belongs to. */
      pipelineId: string;
    }
  | {
      ok: false;
      reason: ResolveStageFailure;
      /** The name we tried to resolve (for error messages), when applicable. */
      attemptedName?: string;
    };

type StageRow = { id: string; name: string; pipelineId: string };

/**
 * Resolve + validate a deal stage.
 *
 * Precedence: an explicit `stageId` wins over a name. Both are validated
 * against the tenant (and pipeline, when supplied) before being accepted.
 */
export async function resolveDealStage(
  exec: StageResolverExecutor,
  input: ResolveStageInput,
): Promise<ResolveStageResult> {
  const { tenantId } = input;
  const stageId = normalizeStageField(input.stageId);
  const pipelineId = normalizeStageField(input.pipelineId);
  const stageName = normalizeStageField(input.stageName);

  // ── Path A: explicit stage_id ─────────────────────────────────────────────
  if (stageId) {
    const rows = await selectStages(exec, tenantId, [eq(dealStages.id, stageId)]);
    const row = rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (pipelineId && row.pipelineId !== pipelineId) {
      return { ok: false, reason: 'pipeline_mismatch' };
    }
    return { ok: true, stageId: row.id, stageName: row.name, pipelineId: row.pipelineId };
  }

  // ── Path B: resolve by name ───────────────────────────────────────────────
  if (stageName) {
    const conds = [ilike(dealStages.name, escapeLike(stageName))];
    // Scope by pipeline up front when provided so same-named stages in other
    // pipelines don't register as ambiguous.
    if (pipelineId) conds.push(eq(dealStages.pipelineId, pipelineId));

    const rows = await selectStages(exec, tenantId, conds);
    if (rows.length === 0) return { ok: false, reason: 'not_found', attemptedName: stageName };
    if (rows.length > 1) return { ok: false, reason: 'ambiguous', attemptedName: stageName };

    const row = rows[0]!;
    return { ok: true, stageId: row.id, stageName: row.name, pipelineId: row.pipelineId };
  }

  return { ok: false, reason: 'missing' };
}

/**
 * Build a human-readable 400 message for a resolution failure, reused by the
 * create + update routes so the copy stays consistent.
 */
export function stageFailureMessage(result: Extract<ResolveStageResult, { ok: false }>): string {
  switch (result.reason) {
    case 'missing':
      return 'stage_id is required (or a valid stage/stage_name).';
    case 'not_found': {
      const named = result.attemptedName
        ? ` No stage named "${result.attemptedName}" was found for this tenant`
        : ' The supplied stage_id does not exist for this tenant';
      return `Could not resolve deal stage.${named}.`;
    }
    case 'ambiguous':
      return `Stage name "${result.attemptedName}" matches multiple stages. Pass pipeline_id (or stage_id) to disambiguate.`;
    case 'pipeline_mismatch':
      return 'The supplied stage_id belongs to a different pipeline than pipeline_id.';
  }
}

/**
 * Shared select scoped to the tenant. We assert `dealStages.tenantId` directly
 * (the table carries its own tenant column) AND join `pipelines` scoped to the
 * same tenant so a stage can never resolve across tenants even if the two
 * tenant columns ever drift.
 */
function selectStages(
  exec: StageResolverExecutor,
  tenantId: string,
  extraConds: ReturnType<typeof eq>[],
): Promise<StageRow[]> {
  return exec
    .select({ id: dealStages.id, name: dealStages.name, pipelineId: dealStages.pipelineId })
    .from(dealStages)
    .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
    .where(
      and(
        eq(dealStages.tenantId, tenantId),
        eq(pipelines.tenantId, tenantId),
        sql`${dealStages.deletedAt} IS NULL`,
        ...extraConds,
      ),
    )
    .limit(2); // limit(2) is enough to detect ambiguity without over-fetching
}

/** Treat '', null, undefined and whitespace-only as "not supplied". */
export function normalizeStageField(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}
