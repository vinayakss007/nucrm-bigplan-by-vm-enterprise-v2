/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The inbound webhook route's stage resolution, split out because that route is
 * under the #1843/#422 size ratchet — the same reason `lib/webhooks/inbound-auth.ts`
 * exists.
 *
 * #3246: these two lookups read `deal_stages` and `pipelines`, both tenant-scoped,
 * and they used to run on the bare pool. That answer was zero rows under the tenant
 * policies, so a webhook that named a stage silently fell back to the default
 * pipeline (or failed with "cannot determine a stage") on a tenant that had exactly
 * the stage it asked for.
 *
 * They take the transaction the item is being written in, for two reasons. The
 * tenant: the lookup must see the same tenant the write will. And the snapshot: a
 * second transaction here would read a different snapshot of the same pipeline the
 * deal is about to be written against, and could pick a stage the write then
 * contradicts.
 */
import { and, asc, desc, eq, ilike, isNull } from 'drizzle-orm';
import { dealStages, pipelines } from '@/drizzle/schema';
import { escapeLike } from '@/lib/api/sanitize-like';
import type { RlsTransaction } from '@/lib/db/rls';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedStage {
  stageId: string;
  pipelineId: string;
}

/**
 * Resolve the stage the caller asked for, tenant-scoped.
 *
 * Mirrors `app/api/tenant/deals/route.ts`: a stage id wins over a stage name,
 * and a name is matched case-insensitively against `deal_stages` joined to
 * `pipelines` so the tenant filter lives on the pipeline row.
 *
 * A caller-supplied id is *never* trusted as-is: it has to come back from the
 * tenant-scoped query, otherwise a webhook key for tenant A could park a deal on
 * tenant B's stage. Returns null when the caller asked for nothing, or asked by
 * a name that matches nothing (the caller's spelling is not authoritative — the
 * create path then falls back to the default pipeline).
 */
export async function resolveRequestedStage(
  suppliedStageId: string | null,
  stageName: string | null,
  tenantId: string,
  tx: RlsTransaction,
): Promise<ResolvedStage | null> {
  if (suppliedStageId) {
    if (!UUID_RE.test(suppliedStageId)) {
      throw new Error(`stage_id must be a uuid (got "${suppliedStageId}"); use "stage" to reference a stage by name`);
    }

    const [row] = await tx
      .select({ id: dealStages.id, pipelineId: dealStages.pipelineId })
      .from(dealStages)
      .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
      .where(and(
        eq(dealStages.id, suppliedStageId),
        eq(pipelines.tenantId, tenantId)
      ))
      .limit(1);

    if (!row) {
      throw new Error(`stage_id ${suppliedStageId} does not belong to this tenant`);
    }
    return { stageId: row.id, pipelineId: row.pipelineId };
  }

  if (stageName) {
    const [row] = await tx
      .select({ id: dealStages.id, pipelineId: dealStages.pipelineId })
      .from(dealStages)
      .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
      .where(and(
        ilike(dealStages.name, escapeLike(stageName)),
        eq(pipelines.tenantId, tenantId)
      ))
      .limit(1);

    if (row) return { stageId: row.id, pipelineId: row.pipelineId };
  }

  return null;
}

/**
 * Fallback for a create with no usable stage input: the first stage of the
 * tenant's default pipeline. `isDefault DESC` puts the flagged pipeline first
 * and still yields a pipeline when none is flagged; `order ASC` then picks the
 * left-most stage. Returns null when the tenant has no pipelines or no stages.
 */
export async function resolveDefaultStage(tenantId: string, tx: RlsTransaction): Promise<ResolvedStage | null> {
  const [pipeline] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(
      eq(pipelines.tenantId, tenantId),
      isNull(pipelines.deletedAt)
    ))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt))
    .limit(1);

  if (!pipeline) return null;

  const [stage] = await tx
    .select({ id: dealStages.id, pipelineId: dealStages.pipelineId })
    .from(dealStages)
    .where(and(
      eq(dealStages.tenantId, tenantId),
      eq(dealStages.pipelineId, pipeline.id),
      isNull(dealStages.deletedAt)
    ))
    .orderBy(asc(dealStages.order))
    .limit(1);

  if (!stage) return null;
  return { stageId: stage.id, pipelineId: stage.pipelineId };
}
