import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { onboardingStepSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { onboardingProgress, pipelines, dealStages } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { installTemplateModules } from '@/lib/modules/auto-install';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';

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
    const isCompleted = stepsDone.includes('completed') || progress.some(p => p.stepName === 'all' && p.isCompleted);

    return NextResponse.json({ 
      steps_done: stepsDone, 
      completed: isCompleted 
    });
  } catch (err) { 
    return NextResponse.json({ steps_done: [], completed: false }); 
  }
}

const provisionSchema = z.object({
  templateId: z.string().min(1),
  modules: z.array(z.string()).min(1),
  companyName: z.string().min(1).max(255),
  pipelineName: z.string().min(1).max(100),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await request.json();
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

    const [newPipeline] = await db.insert(pipelines).values({
      tenantId: ctx.tenantId,
      name: v.pipelineName.trim(),
      isDefault: true,
    }).returning();

    if (newPipeline) {
      await db.insert(dealStages).values(
        pipelineStages.map((stage, idx) => ({
          tenantId: ctx.tenantId,
          pipelineId: newPipeline.id,
          name: stage,
          order: idx,
        }))
      );
    }

    // Mark onboarding as completed
    await db.insert(onboardingProgress).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      stepName: 'completed',
      isCompleted: true,
      completedAt: new Date(),
    }).onConflictDoUpdate({
      target: [onboardingProgress.tenantId, onboardingProgress.userId, onboardingProgress.stepName],
      set: { isCompleted: true, completedAt: new Date() },
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
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const rawBody = await request.json();
    const validated = validateBody(onboardingStepSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    if (v.complete) {
      await db.insert(onboardingProgress).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        stepName: 'completed',
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
  } catch (err: any) { 
    return apiError(err); 
  }
}
