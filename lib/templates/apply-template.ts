/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2633 — the ONE template materializer.
 *
 * Before this file, three entry points (industry-templates POST, modules/setup
 * POST, onboarding POST) each carried their own copy of "insert the template's
 * fields/pipelines/stages/automations", the superadmin assign path carried
 * none, and none of them checked whether the artefact already existed: apply
 * "legal" twice and the tenant got 4 pipelines, 20 stages and two live copies
 * of every automation (measured on the dev host). The module-system's
 * `installTemplateModules` only ever touched `tenant_modules` rows, so the
 * DB-backed `product_templates` table — the one the superadmin UI edits — was
 * decoration; that is the split-brain #2597 made famous, in a second body.
 *
 * Rules this file pins:
 *  - Idempotency is CHECK-THEN-INSERT-AND-REUSE, not schema-unique. Pipelines
 *    and stages are matched by (tenant, name) case-insensitively and reused;
 *    a unique constraint here would be actively wrong — users may legitimately
 *    run two "Sales" pipelines, and deduing deal_stages by unique name is
 *    FK-hostile (`deals.stageId` references stages without cascade). Only
 *    automations got a real constraint (0129), where same-name-live genuinely
 *    means duplicate.
 *  - applyTemplate NEVER deletes and NEVER renumbers. Stages that already
 *    exist keep their rows and their order; missing stages append at
 *    max(order)+n so a user who dragged their kanban is not overwritten by a
 *    re-apply. Relocating existing pipelines (the onboarding "default" dance
 *    where deals must be moved off stages before the old ones die) stays in
 *    the onboarding route — that is relocation semantics, orthogonal to
 *    application, and applyTemplate's contract is "add what is missing".
 *  - tx is REQUIRED. Every consumer runs inside withApiRoute's pinned
 *      connection; taking `db` here would silently escape the request's RLS
 *      GUCs on cache-miss code paths (the #1615 class).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { automations, customFieldDefs, dealStages, pipelines } from '@/drizzle/schema';
import type { RlsTransaction } from '@/lib/db/rls';

/** The blueprint as stored in product_templates JSONB (= the IndustryTemplate shape). */
export interface TemplateBlueprint {
  custom_fields?: Array<{ entity: string; key: string; label: string; type: string }>;
  pipelines?: Array<{ name: string; stages: string[] }>;
  automations?: Array<{ name: string; trigger: string; action: string; config: Record<string, unknown> }>;
}

export interface ApplyCounters {
  pipelines: number;
  stages: number;
  fields: number;
  automations: number;
}

export interface ApplyReport {
  created: ApplyCounters;
  existing: ApplyCounters;
}

const zero = (): ApplyCounters => ({ pipelines: 0, stages: 0, fields: 0, automations: 0 });

export async function applyTemplate(opts: {
  tenantId: string;
  actorUserId: string | null;
  blueprint: TemplateBlueprint;
  tx: RlsTransaction;
}): Promise<ApplyReport> {
  const { tenantId, actorUserId, blueprint, tx } = opts;
  if (!tx) throw new Error('[applyTemplate] tx is required — see #2633 (RLS-pinning discipline, #1615)');

  const created = zero();
  const existing = zero();

  // 1. Custom fields. The one artefact with a real unique index
  // (idx_custom_fields_unique_key), so onConflictDoNothing is load-bearing
  // here; returning() distinguishes landed rows from skipped ones.
  const fields = blueprint.custom_fields ?? [];
  if (fields.length > 0) {
    const inserted = await tx
      .insert(customFieldDefs)
      .values(fields.map((f) => ({
        tenantId,
        entityType: f.entity,
        fieldKey: f.key,
        fieldLabel: f.label,
        fieldType: f.type,
      })))
      .onConflictDoNothing()
      .returning({ id: customFieldDefs.id });
    created.fields = inserted.length;
    existing.fields = fields.length - inserted.length;
  }

  // 2. Pipelines + stages, matched by (tenant, case-insensitive name).
  // The name comparison happens in JS (on the tenant's small pipeline/stage
  // lists) rather than in SQL so the reuse rule is one readable predicate.
  const livePipelines = await tx
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(and(
      eq(pipelines.tenantId, tenantId),
      isNull(pipelines.deletedAt),
    ));

  const liveStages = await tx
    .select({
      pipelineId: dealStages.pipelineId,
      name: dealStages.name,
      order: dealStages.order,
    })
    .from(dealStages)
    .where(and(
      eq(dealStages.tenantId, tenantId),
      isNull(dealStages.deletedAt),
    ));

  for (const pipe of blueprint.pipelines ?? []) {
    const wantName = pipe.name.toLowerCase();
    const live = livePipelines.find((p) => p.name.toLowerCase() === wantName);

    let pipelineId: string;
    if (live) {
      pipelineId = live.id;
      existing.pipelines += 1;
    } else {
      const [row] = await tx
        .insert(pipelines)
        .values({ tenantId, name: pipe.name })
        .returning({ id: pipelines.id });
      if (!row) continue;
      pipelineId = row.id;
      created.pipelines += 1;
      livePipelines.push({ id: row.id, name: pipe.name });
    }

    const stageRows = liveStages.filter((s) => s.pipelineId === pipelineId);
    const have = new Set(stageRows.map((s) => s.name.toLowerCase()));
    let nextOrder = stageRows.length === 0
      ? 0
      : Math.max(...stageRows.map((s) => s.order ?? 0)) + 1;

    const missing = pipe.stages.filter((s) => !have.has(s.toLowerCase()));
    if (missing.length > 0) {
      const rows = missing.map((name) => ({
        tenantId,
        pipelineId,
        name,
        order: nextOrder++,
      }));
      await tx.insert(dealStages).values(rows);
      liveStages.push(...rows);
    }
    created.stages += missing.length;
    existing.stages += pipe.stages.length - missing.length;
  }

  // 3. Automations, matched by live (tenant, name). An existing row is the
  // tenant's own (possibly edited) automation — never overwrite it; 0129's
  // partial unique makes the insert conflict-safe as well.
  const liveAutomations = await tx
    .select({ name: automations.name })
    .from(automations)
    .where(and(
      eq(automations.tenantId, tenantId),
      isNull(automations.deletedAt),
    ));
  for (const auto of blueprint.automations ?? []) {
    if (liveAutomations.some((a) => a.name === auto.name)) {
      existing.automations += 1;
      continue;
    }
    const inserted = await tx
      .insert(automations)
      .values({
        tenantId,
        name: auto.name,
        triggerType: auto.trigger,
        actions: [{ type: auto.action, config: auto.config }],
        createdBy: actorUserId,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning({ id: automations.id });
    if (inserted.length > 0) created.automations += 1;
    else existing.automations += 1;
  }

  return { created, existing };
}
