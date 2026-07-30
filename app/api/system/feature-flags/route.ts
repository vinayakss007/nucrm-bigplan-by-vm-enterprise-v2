import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { getAllFlags, setFeatureFlag } from '@/lib/feature-flags';
import type { FeatureFlag } from '@/lib/feature-flags';
import { readJsonBody } from '@/lib/api/validate';

/**
 * GET /api/system/feature-flags
 * List all feature flags and their current state.
 * Protected: superadmin only.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const flags = await getAllFlags();
    return NextResponse.json({ data: flags });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * POST /api/system/feature-flags
 * Create or update a feature flag.
 * Body: { key, enabled, rolloutPercentage?, targetTenants?, targetUsers?, description? }
 * Protected: superadmin only.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await readJsonBody(request);
    const { key, enabled, rolloutPercentage, targetTenants, targetUsers, description } = body as Partial<FeatureFlag>;

    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    const flag: FeatureFlag = {
      key,
      enabled,
      rolloutPercentage: rolloutPercentage ?? undefined,
      targetTenants: Array.isArray(targetTenants) ? targetTenants : undefined,
      targetUsers: Array.isArray(targetUsers) ? targetUsers : undefined,
      description: description || undefined,
    };

    await setFeatureFlag(flag);

    return NextResponse.json({ data: flag, message: `Flag "${key}" updated` });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
