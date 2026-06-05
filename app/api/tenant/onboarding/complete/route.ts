import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { markOnboardingComplete, recordOnboardingStep } from '@/lib/onboarding/check';
import { ModuleRegistry } from '@/lib/modules/registry';

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
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const { product_id, modules = [], company_name, pipeline_name } = body;

    // Record which product they chose
    if (product_id) {
      await recordOnboardingStep(ctx.tenantId, ctx.userId, `product_selected:${product_id}`);
    }

    // Install selected modules
    for (const moduleId of modules) {
      try {
        await ModuleRegistry.install(ctx.tenantId, moduleId, ctx.userId);
      } catch (err) {
        console.error(`[Onboarding] Failed to install module ${moduleId}:`, err);
        // Don't fail the whole onboarding for one module
      }
    }

    // Record setup info
    if (company_name) {
      await recordOnboardingStep(ctx.tenantId, ctx.userId, 'company_name_set');
    }
    if (pipeline_name) {
      await recordOnboardingStep(ctx.tenantId, ctx.userId, 'pipeline_configured');
    }

    // Mark onboarding as fully complete
    await markOnboardingComplete(ctx.tenantId, ctx.userId);

    return NextResponse.json({
      success: true,
      message: 'Onboarding complete! Your workspace is ready.',
      modules_installed: modules.length,
    });
  } catch (err: any) {
    console.error('[Onboarding Complete] Error:', err);
    return apiError(err);
  }
}

/**
 * GET /api/tenant/onboarding/complete
 * Check if current user has completed onboarding.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { hasCompletedOnboarding } = await import('@/lib/onboarding/check');
    const completed = await hasCompletedOnboarding(ctx.tenantId, ctx.userId);

    return NextResponse.json({ completed });
  } catch (err: any) {
    return NextResponse.json({ completed: true }); // Don't block on error
  }
}
