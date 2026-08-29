/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { markOnboardingComplete, recordOnboardingStep } from '@/lib/onboarding/check';
import { ModuleRegistry } from '@/lib/modules/registry';
import { readJsonBody } from '@/lib/api/validate';
import { db } from '@/drizzle/db';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * POST /api/tenant/onboarding/complete
 * 
 * Called when user finishes the onboarding wizard.
 * Marks onboarding as complete and installs selected modules.
 *
 * Body: {
 *   product_id: string,
 *   modules: string[],
 *   company_name?: string,
 *   pipeline_name?: string,
 * }
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(request);
    const { product_id, modules = [], company_name, pipeline_name } = body;

    // Install selected modules FIRST, best-effort. Each install runs in its own
    // transaction (see ModuleRegistry.install) and returns { ok, error } rather
    // than throwing, so a single module failing does not abort onboarding — the
    // intended product behavior. We surface how many succeeded in the response.
    let modulesInstalled = 0;
    for (const moduleId of modules) {
      try {
        const result = await ModuleRegistry.install(ctx.tenantId, moduleId, ctx.userId);
        if (result.ok) {
          modulesInstalled++;
        } else {
          console.error(`[Onboarding] Failed to install module ${moduleId}: ${result.error}`);
        }
      } catch (err) {
        console.error(`[Onboarding] Failed to install module ${moduleId}:`, err);
        // Don't fail the whole onboarding for one module
      }
    }

    // Record onboarding-progress writes atomically (#1049). Previously these ran
    // sequentially without a transaction, so a failure partway (e.g. after
    // recording product_selected but before markOnboardingComplete) left the
    // onboarding state inconsistent. Wrapping them in a single transaction makes
    // the progress state all-or-nothing.
    await db.transaction(async (tx) => {
      // Record which product they chose
      if (product_id) {
        await recordOnboardingStep(ctx.tenantId, ctx.userId, `product_selected:${product_id}`, tx);
      }

      // Record setup info
      if (company_name) {
        await recordOnboardingStep(ctx.tenantId, ctx.userId, 'company_name_set', tx);
      }
      if (pipeline_name) {
        await recordOnboardingStep(ctx.tenantId, ctx.userId, 'pipeline_configured', tx);
      }

      // Mark onboarding as fully complete
      await markOnboardingComplete(ctx.tenantId, ctx.userId, tx);
    });

    return NextResponse.json({
      success: true,
      message: 'Onboarding complete! Your workspace is ready.',
      modules_installed: modulesInstalled,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Onboarding Complete] Error:', err);
    return apiError(err);
  }
});

/**
 * GET /api/tenant/onboarding/complete
 * Check if current user has completed onboarding.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { hasCompletedOnboarding } = await import('@/lib/onboarding/check');
    const completed = await hasCompletedOnboarding(ctx.tenantId, ctx.userId);

    return NextResponse.json({ completed });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (_err: any) {
    return NextResponse.json({ completed: false }); // Don't block on error
  }
});
