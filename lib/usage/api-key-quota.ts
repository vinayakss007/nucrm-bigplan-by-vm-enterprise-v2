/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * API-key call quota (#2432).
 *
 * `plans.max_api_calls_day` is sold in the plan editor and rendered by the
 * billing page, but nothing in the codebase read it: the API-key auth path
 * logged every call into `api_key_usage` and never compared that ledger to the
 * plan. requireAuth() is the single chokepoint that sees every `ak_` request,
 * so the cap is applied there — via this helper, so the policy (and its
 * deliberate fail-open) lives in one place with the measurement it depends on.
 *
 * Ordering constraint: the caller must run this AFTER setTenantContext(),
 * because `api_key_usage` is RLS-scoped — counting before the tenant GUC is
 * set silently yields 0 and the cap never fires.
 */
import type { NextResponse } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';
import { checkLimit } from '@/lib/usage/middleware';
import { logger } from '@/lib/logger';

/**
 * Returns a 402 when the tenant is over its daily API-call cap and
 * `USAGE_LIMITS=on`; null when the request may proceed. With enforcement off
 * the violation is still recorded and the owner alerted, so the number becomes
 * visible during a rollout instead of after one.
 *
 * DELIBERATELY FAILS OPEN on a measurement error. This is a billing control,
 * not an access control: unlike `hasScope()` / `requireApiKeyScope()`, which
 * deny on doubt, a broken count must not turn every authenticated API request
 * into an outage. The call's `api_key_usage` row was already written by
 * `tryApiKeyAuth()`, so even a blocked request stays counted and the tenant's
 * running total remains honest.
 */
export async function checkApiKeyCallQuota(ctx: AuthContext): Promise<NextResponse | null> {
  try {
    return await checkLimit(ctx, 'apiCallsDay');
  } catch (err) {
    logger.warn('[usage] api-calls quota check failed, allowing request', {
      tenantId: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
