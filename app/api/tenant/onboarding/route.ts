import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { onboardingStepSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { onboardingProgress, pipelines, dealStages } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { installTemplateModules } from '@/lib/modules/auto-install';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

export async function GET(request: NextRequest) {
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
}

const provisionSchema = z.object({
  templateId: z.string().min(1),
  modules: z.array(z.string()).min(1),
  companyName: z.string().min(1).max(255).optional(),
  pipelineName: z.string().min(1).max(100),
});

export async function POST(request: NextRequest) {
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
      // Remove existing default pipelines and their stages to avoid duplicates
      const existingDefaults = await tx.select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.isDefault, true)));

      for (const old of existingDefaults) {
        await tx.delete(dealStages).where(
          and(eq(dealStages.tenantId, ctx.tenantId), eq(dealStages.pipelineId, old.id))
        );
        await tx.delete(pipelines).where(eq(pipelines.id, old.id));
      }

      const [p] = await tx.insert(pipelines).values({
        tenantId: ctx.tenantId,
        name: v.pipelineName.trim(),
        isDefault: true,
      }).returning();

      if (p) {
        await tx.insert(dealStages).values(
          pipelineStages.map((stage, idx) => ({
            tenantId: ctx.tenantId,
            pipelineId: p.id,
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

      return [p];
    });

    return NextResponse.json({
      ok: true,
      pipelineId: newPipeline?.id ?? null,
      modulesInstalled: v.modules.length,
    }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
  const limited = await rateLimitMutating(request, 'settings', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const rawBody = await readJsonBody(request);
    const validated = validateBody(onboardingStepSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    if (v.complete) {
      await db.insert(onboardingProgress).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        stepName: 'onboarding_complete',
        isCompleted: true,
        completedAt: new Date(),
      }).onConflictDoUpdate({
        target: [onboardingProgress.tenantId, onboardingProgress.userId, onboardingProgress.stepName],
        set: { isCompleted: true, completedAt: new Date(), updatedAt: new Date() }
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
        set: { isCompleted: true, completedAt: new Date(), updatedAt: new Date() }
      });
    }
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}
