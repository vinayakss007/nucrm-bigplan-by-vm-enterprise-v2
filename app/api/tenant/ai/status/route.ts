/**
 * AI Hub status — drives the landing dashboard.
 * GET /api/tenant/ai/status
 *
 * Returns provider readiness + today's usage stats. Read-only.
 *
 * Reads ai_activity (now a real Drizzle-managed table) and ai_provider_secrets
 * (via lib/ai/secrets) so the AI Hub shell pages can show live counters and
 * tell the user which providers are ready vs missing keys.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { aiActivity } from '@/drizzle/schema/ai';
import { eq, sql, and, gte } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { listProviderKeyMeta } from '@/lib/ai/secrets';
import { getAtRiskDeals } from '@/lib/ai/at-risk';

/** Named providers to always show in the dashboard (even if not configured). */
const NAMED_PROVIDER_IDS = ['openai', 'anthropic', 'groq', 'ollama', 'opencode', 'deepseek'];

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    // Provider readiness: enabled flag from tenants.settings + key presence from vault.
    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    const aiSettings = ((t?.settings as Record<string, unknown> | null) ?? {})['ai_providers'] as Record<string, { enabled?: boolean }> | undefined ?? {};
    const keyMeta = await listProviderKeyMeta(ctx.tenantId);

    // Dynamic: named presets + any custom providers that have keys stored
    const allProviderIds = new Set([...NAMED_PROVIDER_IDS, ...Object.keys(keyMeta)]);
    const providers = Array.from(allProviderIds).map(id => {
      const enabled = aiSettings[id]?.enabled === true;
      const present = keyMeta[id]?.present ?? false;
      let status: 'ready' | 'missing_key' | 'disabled' = 'disabled';
      if (enabled && present) status = 'ready';
      else if (enabled && !present) status = 'missing_key';
      return {
        id,
        enabled,
        present,
        status,
        key_prefix: keyMeta[id]?.keyPrefix ?? null,
        rotated_at: keyMeta[id]?.rotatedAt ?? null,
      };
    });
    const enabled_count = providers.filter(p => p.status === 'ready').length;

    // Today's counters from ai_activity. midnightLocal is approximate but the
    // index-friendly path here uses a single `created_at >= now()::date` predicate
    // which Postgres rewrites to the index range scan via the (tenant, created_at) idx.
    const startOfDay = sql<Date>`now()::date`;

    type TodayRow = {
      action: string;
      tokens: number;
      calls: number;
    };

    const todayRows = await db
      .select({
        action: aiActivity.action,
        tokens: sql<number>`COALESCE(SUM(${aiActivity.tokensUsed}), 0)::int`,
        calls: sql<number>`COUNT(*)::int`,
      })
      .from(aiActivity)
      .where(and(
        eq(aiActivity.tenantId, ctx.tenantId),
        gte(aiActivity.createdAt, startOfDay),
        eq(aiActivity.status, 'success'),
      ))
      .groupBy(aiActivity.action) as TodayRow[];

    let draft_count_today = 0;
    let scoring_runs_today = 0;
    let tokens_today = 0;
    for (const row of todayRows) {
      tokens_today += Number(row.tokens) || 0;
      if (row.action === 'draft') draft_count_today += Number(row.calls) || 0;
      if (row.action === 'lead_scoring') scoring_runs_today += Number(row.calls) || 0;
    }

    // At-risk: dynamic calculation based on tenant rules
    let at_risk_count = 0;
    try {
      const atRiskDeals = await getAtRiskDeals(ctx.tenantId);
      at_risk_count = atRiskDeals.length;
    } catch {
      // Silently skip during migration/setup when tables may not exist yet
    }

    return NextResponse.json({
      providers,
      enabled_count,
      draft_count_today,
      scoring_runs_today,
      tokens_today,
      at_risk_count,
    });
  } catch (err) {
    return apiError(err);
  }
}
