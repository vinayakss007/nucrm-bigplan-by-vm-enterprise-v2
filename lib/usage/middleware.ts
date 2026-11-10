/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Usage middleware — drop into any API route to enforce a plan limit.
 *
 *   const ctx = await requireAuth(req); if (ctx instanceof NextResponse) return ctx;
 *   const blocked = await checkLimit(ctx, 'contacts'); if (blocked) return blocked;
 *
 * Behavior:
 *   - Off by default. Set `USAGE_LIMITS=on` to enable enforcement.
 *   - When off, the function still records violations but never blocks the
 *     request, so dashboards/alerts get accurate data during rollout.
 *   - Super-admins bypass entirely.
 *   - `null` (unlimited) plan limits skip the check.
 */
import { NextResponse } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';
import { NO_TENANT_SENTINEL } from '@/lib/db/rls';
import { getUsageReport, recordViolation, type LimitKind } from './tracker';
import { notifyLimitHit } from './notifications';
import { logger } from '@/lib/logger';

const ENFORCE = process.env['USAGE_LIMITS'] === 'on';

/**
 * Whether plan limits are expected to BLOCK this caller right now — the same two
 * conditions `checkLimit` applies before it returns a 402.
 *
 * #3409: a route that has to make the limit decision a second time, inside the
 * transaction where it actually writes, must ask here rather than re-read
 * `USAGE_LIMITS` by hand. Two independent readings of one policy is how a gate
 * ends up enforced in one door and advisory in the next.
 */
export function limitsEnforce(ctx: { isSuperAdmin: boolean; tenantId?: string | null }): boolean {
  if (ctx.isSuperAdmin) return false;
  if (!ctx.tenantId || ctx.tenantId === NO_TENANT_SENTINEL) return false;
  return ENFORCE;
}

export interface CheckLimitOptions {
  /** Override the env flag, e.g. for routes that must always block. */
  enforce?: boolean;
}

/**
 * The refusal a tenant gets when a plan limit stops a write: 402 plus this body.
 *
 * #3409: a route that has to decide the limit a second time, inside its own
 * write transaction, returns this exact response. Hand-copying the body at each
 * door is how a client ends up told one thing by the pre-flight and another by
 * the fence that actually stopped it.
 */
export function planLimitReachedResponse(
  kind: LimitKind,
  limit: number,
  actual: number,
): NextResponse {
  return NextResponse.json(
    {
      error: `Plan limit reached for ${kind}`,
      kind,
      limit,
      actual,
      upgradeUrl: '/tenant/settings/billing',
    },
    { status: 402 },
  );
}

/**
 * Returns a 402 NextResponse when the tenant has hit the limit *and*
 * enforcement is enabled. Returns null otherwise.
 */
export async function checkLimit(
  ctx: AuthContext,
  kind: LimitKind,
  opts: CheckLimitOptions = {},
): Promise<NextResponse | null> {
  if (ctx.isSuperAdmin) return null;
  if (!ctx.tenantId || ctx.tenantId === NO_TENANT_SENTINEL) return null;

  const report = await getUsageReport(ctx.tenantId, kind);
  if (!report.exceeded) return null;
  if (report.limit == null) return null;

  // Record the violation regardless of enforcement so analytics stay accurate.
  const { created } = await recordViolation(ctx.tenantId, kind, report.limit, report.actual);
  if (created) {
    notifyLimitHit({
      tenantId: ctx.tenantId,
      kind,
      limit: report.limit,
      actual: report.actual,
    }).catch((err) => {
      logger.warn('[usage-middleware] Failed to send limit-hit notification', {
        tenantId: ctx.tenantId, kind,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const enforce = opts.enforce ?? ENFORCE;
  if (!enforce) return null;

  return planLimitReachedResponse(kind, report.limit, report.actual);
}
