/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { onboardingStepSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { onboardingProgress, pipelines, dealStages, deals } from '@/drizzle/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { installTemplateModules } from '@/lib/modules/auto-install';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const progress = await db.select()
      .from(onboardingProgress)
      .where(and(
        eq(onboardingProgress.tenantId, ctx.tenantId),
        eq(onboardingProgress.userId, ctx.userId)
      ));

    const stepsDone = progress.filter(p => p.isCompleted).map(p => p.stepName);
    const isCompleted = stepsDone.includes('onboarding_complete') || stepsDone.includes('completed') || progress.some(p => p.stepName === 'all' && p.isCompleted);

    return NextResponse.json({ 
      steps_done: stepsDone, 
      completed: isCompleted 
    });
  } catch { 
    return NextResponse.json({ steps_done: [], completed: false }); 
  }
});

const provisionSchema = z.object({
  templateId: z.string().min(1),
  modules: z.array(z.string()).min(1),
  companyName: z.string().min(1).max(255).optional(),
  pipelineName: z.string().min(1).max(100),
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(provisionSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const template = INDUSTRY_TEMPLATES[v.templateId];

    // Install modules for the tenant based on the selected template
    await installTemplateModules(ctx.tenantId, v.templateId);

    // Create the primary pipeline with stages from the template
    const pipelineStages = template?.pipelines[0]?.stages ?? [
      'Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost',
    ];

    const [newPipeline] = await db.transaction(async (tx) => {
      // Find existing default pipelines for this tenant
      const existingDefaults = await tx.select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.isDefault, true)));

      let pipelineId: string;

      if (existingDefaults.length > 0) {
        // Update the first existing default pipeline in place to avoid FK violations
        // on deals.stageId which references dealStages.id without ON DELETE CASCADE
        const primaryPipeline = existingDefaults[0]!;
        pipelineId = primaryPipeline.id;

        // Update pipeline name
        await tx.update(pipelines)
          .set({ name: v.pipelineName.trim() })
          .where(eq(pipelines.id, pipelineId));

        // Get old stage IDs for this pipeline
        const oldStages = await tx.select({ id: dealStages.id })
          .from(dealStages)
          .where(and(eq(dealStages.tenantId, ctx.tenantId), eq(dealStages.pipelineId, pipelineId)));

        if (oldStages.length > 0) {
          const oldStageIds = oldStages.map(s => s.id);

          // Insert new stages first so we have a valid target for deal reassignment
          const insertedStages = await tx.insert(dealStages).values(
            pipelineStages.map((stage, idx) => ({
              tenantId: ctx.tenantId,
              pipelineId,
              name: stage,
              order: idx,
            }))
          ).returning();

          // Reassign any deals that reference old stages to the first new stage
          const firstNewStageId = insertedStages[0]?.id;
          if (firstNewStageId) {
            await tx.update(deals)
              .set({ stageId: firstNewStageId })
              .where(and(
                eq(deals.tenantId, ctx.tenantId),
                inArray(deals.stageId, oldStageIds)
              ));
          }

          // Now safe to delete old stages (no FK references remain)
          await tx.delete(dealStages).where(
            and(eq(dealStages.tenantId, ctx.tenantId), inArray(dealStages.id, oldStageIds))
          );
        } else {
          // No existing stages, just insert new ones
          await tx.insert(dealStages).values(
            pipelineStages.map((stage, idx) => ({
              tenantId: ctx.tenantId,
              pipelineId,
              name: stage,
              order: idx,
            }))
          );
        }

        // Remove any additional duplicate default pipelines (keep only the primary)
        if (existingDefaults.length > 1) {
          for (const extra of existingDefaults.slice(1)) {
            const extraStages = await tx.select({ id: dealStages.id })
              .from(dealStages)
              .where(and(eq(dealStages.tenantId, ctx.tenantId), eq(dealStages.pipelineId, extra.id)));

            if (extraStages.length > 0) {
              const extraStageIds = extraStages.map(s => s.id);
              // Reassign deals from extra pipeline stages to the first new stage
              const firstStage = await tx.select({ id: dealStages.id })
                .from(dealStages)
                .where(and(eq(dealStages.tenantId, ctx.tenantId), eq(dealStages.pipelineId, pipelineId)))
                .limit(1);

              if (firstStage[0]) {
                await tx.update(deals)
                  .set({ stageId: firstStage[0].id })
                  .where(and(
                    eq(deals.tenantId, ctx.tenantId),
                    inArray(deals.stageId, extraStageIds)
                  ));
              }

              await tx.delete(dealStages).where(
                and(eq(dealStages.tenantId, ctx.tenantId), inArray(dealStages.id, extraStageIds))
              );
            }

            await tx.delete(pipelines).where(eq(pipelines.id, extra.id));
          }
        }
      } else {
        // No existing default pipeline, create a new one
        const [p] = await tx.insert(pipelines).values({
          tenantId: ctx.tenantId,
          name: v.pipelineName.trim(),
          isDefault: true,
        }).returning();

        if (!p) throw new Error('Failed to create pipeline');
        pipelineId = p.id;

        await tx.insert(dealStages).values(
          pipelineStages.map((stage, idx) => ({
            tenantId: ctx.tenantId,
            pipelineId,
            name: stage,
            order: idx,
          }))
        );
      }

      await tx.insert(onboardingProgress).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        stepName: 'onboarding_complete',
        isCompleted: true,
        completedAt: new Date(),
      }).onConflictDoUpdate({
        target: [onboardingProgress.tenantId, onboardingProgress.userId, onboardingProgress.stepName],
        set: { isCompleted: true, completedAt: new Date(), updatedAt: new Date() },
      });

      return [{ id: pipelineId }];
    });

    return NextResponse.json({
      ok: true,
      pipelineId: newPipeline?.id ?? null,
      modulesInstalled: v.modules.length,
    }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'settings', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const rawBody = await readJsonBody(request);
    const validated = validateBody(onboardingStepSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const guardResult = await concurrencyGuard(db, onboardingProgress, undefined, ctx.tenantId, (rawBody as Record<string, unknown>).expectedUpdatedAt as string | Date | null | undefined);
    if (guardResult) return guardResult;

    if (v.complete) {
      await db.insert(onboardingProgress).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        stepName: 'onboarding_complete',
        isCompleted: true,
        completedAt: new Date(),
      }).onConflictDoUpdate({
        target: [onboardingProgress.tenantId, onboardingProgress.userId, onboardingProgress.stepName],
        set: { isCompleted: true, completedAt: new Date() }
      });
    } else if (v.step) {
      await db.insert(onboardingProgress).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        stepName: v.step,
        isCompleted: true,
        completedAt: new Date(),
      }).onConflictDoUpdate({
        target: [onboardingProgress.tenantId, onboardingProgress.userId, onboardingProgress.stepName],
        set: { isCompleted: true, completedAt: new Date() }
      });
    }
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
});
