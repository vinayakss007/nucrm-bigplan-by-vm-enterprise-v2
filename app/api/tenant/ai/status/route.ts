/**
 * AI Hub status — drives the landing dashboard.
 * GET /api/tenant/ai/status
 *
 * Returns provider readiness + today's usage stats. Read-only.
 * Falls back gracefully when the AI activity table doesn't exist yet.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

const PROVIDER_IDS = ['openai', 'anthropic', 'groq', 'ollama'] as const;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);

    const ai = ((t?.settings as any) ?? {}).ai_providers ?? {};

    const providers = PROVIDER_IDS.map(id => {
      const cfg = ai[id] ?? {};
      const enabled = cfg.enabled === true;
      const hasKey = id === 'ollama' ? !!cfg.base_url : !!cfg.api_key_set;
      let status: 'ready' | 'missing_key' | 'error' = 'ready';
      if (enabled && !hasKey) status = 'missing_key';
      return { id, enabled, status };
    });
    const enabled_count = providers.filter(p => p.enabled && p.status === 'ready').length;

    // Try to read aggregate counts from ai_activity if it exists; otherwise zero.
    let draft_count_today = 0;
    let scoring_runs_today = 0;
    let tokens_today = 0;
    let at_risk_count = 0;

    try {
      const result = await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN action = 'draft' AND created_at::date = CURRENT_DATE THEN 1 ELSE 0 END), 0)::int AS draft_count_today,
          COALESCE(SUM(CASE WHEN action = 'lead_scoring' AND created_at::date = CURRENT_DATE THEN 1 ELSE 0 END), 0)::int AS scoring_runs_today,
          COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE THEN tokens_used ELSE 0 END), 0)::int AS tokens_today
        FROM ai_activity
        WHERE tenant_id = ${ctx.tenantId}
      `);
      const row = (result as any).rows?.[0];
      if (row) {
        draft_count_today = Number(row.draft_count_today) || 0;
        scoring_runs_today = Number(row.scoring_runs_today) || 0;
        tokens_today = Number(row.tokens_today) || 0;
      }
    } catch {
      // Table doesn't exist yet — silently fall back to zeros
    }

    try {
      const result = await db.execute(sql`
        SELECT count(*)::int AS at_risk
        FROM deals
        WHERE tenant_id = ${ctx.tenantId}
          AND deleted_at IS NULL
          AND COALESCE(metadata->>'outcome','') NOT IN ('won','lost')
          AND updated_at < NOW() - INTERVAL '14 days'
      `);
      const row = (result as any).rows?.[0];
      at_risk_count = Number(row?.at_risk) || 0;
    } catch {}

    return NextResponse.json({
      providers,
      enabled_count,
      draft_count_today,
      scoring_runs_today,
      tokens_today,
      at_risk_count,
    });
  } catch (err: any) {
    return apiError(err);
  }
}
