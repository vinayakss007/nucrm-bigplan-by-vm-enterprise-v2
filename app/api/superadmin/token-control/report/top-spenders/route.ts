/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { aiUsageAggregated, tenants } from '@/drizzle/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { withSecurityContext } from '@/lib/db/rls';
import { clampInt } from '@/lib/api/query-params';

/**
 * GET /api/superadmin/token-control/report/top-spenders
 * The "Top Spenders (This Month)" table of /superadmin/token-control.
 *
 * The page has asked for this URL since #1328 wired it to TanStack Query
 * (`app/superadmin/token-control/page.tsx:74`), and there was no
 * `…/token-control/report/` directory to answer it: `git log --diff-filter=D` on that
 * path is empty, so nothing was deleted — it was never written. Next's 404 landed in
 * `spendersQuery.error`, which #2823 later learned to render, and before that became
 * `topTenants = []` and a "No spending data yet" line served to every super admin on
 * every install as if it were a fact about their tenants.
 *
 * WHAT IT READS
 * ------------
 * `ai_usage_aggregated` — the same per-tenant, per-module, per-period ledger
 * `recordUsage()` maintains (`lib/ai/common.ts:171-227`) and `checkTokenAndLimits()`
 * compares against `tenant_token_limits.total_monthly_cost` (`:102`). So a tenant that
 * is shown here is a tenant whose caps are being charged there: the report cannot drift
 * from the enforcement it sits next to. Cost columns are cents on both sides, which is
 * what the page's `formatCurrency` divides by 100.
 *
 * The window is the current billing period — the `TO_CHAR(NOW(), 'YYYY-MM')` string the
 * Budgets tab next to it already filters on (`budgets/route.ts:41`), not a rolling 30
 * days, so the two tables agree.
 *
 * The table's three service columns are the platform's own buckets
 * (`lib/ai/common.ts:47-52` — "any OpenAI/WhatsApp/Voice API call", module
 * `'whatsapp'`/`'voice'`/`'lead_scoring'`…, service `'openai'`/`'whatsapp'`/`'twilio'`…):
 * `whatsapp_cents` and `voice_cents` are those modules, and `openai_cents` is the
 * model-gateway spend — every other module. It is labelled OpenAI because that is the
 * service the budget books AI calls against; the ledger does not record which provider
 * answered, so the figure is not narrowed to one. `total_cents` is the tenant's whole
 * month, which is why it can exceed the three columns.
 *
 * WHY IT NEEDS A SECURITY CONTEXT
 * -------------------------------
 * This is a cross-tenant read, and `ai_usage_aggregated`'s policy is the looped
 * `tenant_isolation` from `0037_tenant_isolation_hardening.sql:245-252`, which gates on
 * `app.current_tenant` alone. A tenant-less console session therefore sees zero rows —
 * and returns them as a 200 with an empty list, which is the quiet failure
 * `lib/cron/tenant-scope.ts:29-34` describes as "worse than a failure because it is
 * indistinguishable from success". `0131` adds a SELECT-only waiver for
 * `app.is_super_admin`, and this read runs inside `withSecurityContext()` so the waiver
 * applies for exactly the two statements that need it and no longer.
 */

/** The page's table has no pager; ten rows is what the panel is sized for. */
const DEFAULT_LIMIT = 10;
/** A console read of a platform-wide GROUP BY, so the cap is a guard rail, not a policy. */
const MAX_LIMIT = 100;

const WHATSAPP_MODULE = 'whatsapp';
const VOICE_MODULE = 'voice';

const cents = sql`COALESCE(SUM(${aiUsageAggregated.costCents}), 0)`;

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);

    const period = sql`TO_CHAR(NOW(), 'YYYY-MM')`;
    const inPeriod = and(eq(aiUsageAggregated.billingPeriod, period), isNull(aiUsageAggregated.deletedAt));

    // One transaction, two aggregates: the ranked tenants and the denominator their
    // percentages are taken against. Doing the division over the returned rows would
    // make "% of Total" a share of the top N, which is not what the column says.
    const [ranked, platform] = await withSecurityContext(async (tx) => {
      const rows = await tx
        .select({
          tenant_id: aiUsageAggregated.tenantId,
          tenant_name: tenants.name,
          openai_cents: sql<string | number>`COALESCE(SUM(${aiUsageAggregated.costCents}) FILTER (WHERE ${aiUsageAggregated.moduleName} NOT IN (${WHATSAPP_MODULE}, ${VOICE_MODULE})), 0)`,
          whatsapp_cents: sql<string | number>`COALESCE(SUM(${aiUsageAggregated.costCents}) FILTER (WHERE ${aiUsageAggregated.moduleName} = ${WHATSAPP_MODULE}), 0)`,
          voice_cents: sql<string | number>`COALESCE(SUM(${aiUsageAggregated.costCents}) FILTER (WHERE ${aiUsageAggregated.moduleName} = ${VOICE_MODULE}), 0)`,
          total_cents: sql<string | number>`${cents}`,
        })
        .from(aiUsageAggregated)
        .innerJoin(tenants, eq(tenants.id, aiUsageAggregated.tenantId))
        .where(and(inPeriod, isNull(tenants.deletedAt)))
        .groupBy(aiUsageAggregated.tenantId, tenants.name)
        .orderBy(sql`${cents} DESC`)
        .limit(limit);

      const [totals] = await tx
        .select({
          // Read back rather than recomputed in JS: this is the string the rows were
          // selected with, and a UTC month boundary here would mislabel the window.
          period: sql<string>`TO_CHAR(NOW(), 'YYYY-MM')`,
          total_cents: sql<string | number>`${cents}`,
        })
        .from(aiUsageAggregated)
        .where(inPeriod);

      return [rows, totals] as const;
    });

    // int8 comes back from the driver as a string, and `.toFixed` on the page's
    // `pct_of_total` needs a number, so every figure is normalised here rather than
    // leaving the renderer to guess.
    const platformTotal = Number(platform?.total_cents ?? 0);
    return NextResponse.json({
      period: platform?.period ?? null,
      platform_total_cents: platformTotal,
      tenants: ranked.map((row) => {
        const totalCents = Number(row.total_cents);
        return {
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_name,
          openai_cents: Number(row.openai_cents),
          whatsapp_cents: Number(row.whatsapp_cents),
          voice_cents: Number(row.voice_cents),
          total_cents: totalCents,
          pct_of_total: platformTotal > 0 ? Math.round((totalCents / platformTotal) * 1000) / 10 : 0,
        };
      }),
    });
  } catch (err: unknown) {
    // A read that failed is not a month with no spending: `apiError` answers 5xx, the
    // page renders `spendersQuery.error` (#2823), and the empty list stays what it
    // means — nobody spent anything.
    return apiError(err);
  }
});
