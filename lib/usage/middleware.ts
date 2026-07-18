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
import { getUsageReport, recordViolation, type LimitKind } from './tracker';
import { notifyLimitHit } from './notifications';

const ENFORCE = process.env['USAGE_LIMITS'] === 'on';

export interface CheckLimitOptions {
  /** Override the env flag, e.g. for routes that must always block. */
  enforce?: boolean;
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
  if (!ctx.tenantId || ctx.tenantId === '__superadmin_no_tenant__') return null;

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
    }).catch(() => {});
  }

  const enforce = opts.enforce ?? ENFORCE;
  if (!enforce) return null;

  return NextResponse.json(
    {
      error: `Plan limit reached for ${kind}`,
      kind,
      limit: report.limit,
      actual: report.actual,
      upgradeUrl: '/tenant/settings/billing',
    },
    { status: 402 },
  );
}
