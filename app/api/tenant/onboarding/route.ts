import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { onboardingStepSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { onboardingProgress } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

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
