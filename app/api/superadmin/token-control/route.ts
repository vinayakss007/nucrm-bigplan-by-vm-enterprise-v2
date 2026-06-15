import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tokenBudgets, tenantTokenLimits, usageAlerts, costAnomalies, tenants } from '@/drizzle/schema';
import { eq, sql, desc, asc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const tokenControlSchema = z.object({
  action: z.enum(['update_global_budget', 'update_tenant_limit', 'ack_alert']),
  data: z.record(z.string(), z.unknown()),
});

/**
 * NuCRM — Token Control API (Superadmin Only)
 * 
 * Purpose: Allows superadmins to:
 *  - Monitor global AI budgets (OpenAI, WhatsApp, Twilio, etc.)
 *  - Set hard/soft caps for the entire platform
 *  - Configure per-tenant AI usage limits
 *  - View usage alerts and anomalies
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Fetch all monitoring data in parallel
    const [globalBudgets, tenantLimits, usageAlertsRes, anomalies] = await Promise.all([
      // 1. Current month global budgets
      db
        .select({
          service: tokenBudgets.service,
          monthlyBudgetCents: tokenBudgets.monthlyBudgetCents,
          currentMonthCents: tokenBudgets.currentMonthCents,
          hardCapEnabled: tokenBudgets.hardCapEnabled,
          alertAt80pct: tokenBudgets.alertAt80pct,
          alertAt100pct: tokenBudgets.alertAt100pct,
        })
        .from(tokenBudgets)
        .where(eq(tokenBudgets.billingPeriod, sql`TO_CHAR(NOW(), 'YYYY-MM')`)),
      
      // 2. All tenant-specific limits
      db
        .select({
          id: tenantTokenLimits.id,
          tenantId: tenantTokenLimits.tenantId,
          openaiMonthlyLimit: tenantTokenLimits.openaiMonthlyLimit,
          whatsappMonthlyMsgs: tenantTokenLimits.whatsappMonthlyMsgs,
          voiceMonthlyMins: tenantTokenLimits.voiceMonthlyMins,
          contentMonthlyGen: tenantTokenLimits.contentMonthlyGen,
          proposalMonthlyGen: tenantTokenLimits.proposalMonthlyGen,
          followupMonthlyCnt: tenantTokenLimits.followupMonthlyCnt,
          scoreMonthlyCnt: tenantTokenLimits.scoreMonthlyCnt,
          totalMonthlyCost: tenantTokenLimits.totalMonthlyCost,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
        })
        .from(tenantTokenLimits)
        .innerJoin(tenants, eq(tenants.id, tenantTokenLimits.tenantId))
        .orderBy(asc(tenants.name)),
      
      // 3. Recent usage alerts (unacknowledged first)
      db
        .select()
        .from(usageAlerts)
        .orderBy(asc(usageAlerts.acknowledged), desc(usageAlerts.createdAt))
        .limit(50),

      // 4. Detected anomalies
      db
        .select({
          id: costAnomalies.id,
          tenantId: costAnomalies.tenantId,
          service: costAnomalies.service,
          expectedDailyCents: costAnomalies.expectedDailyCents,
          actualDailyCents: costAnomalies.actualDailyCents,
          deviationPct: costAnomalies.deviationPct,
          suspectedCause: costAnomalies.suspectedCause,
          createdAt: costAnomalies.createdAt,
          tenantName: tenants.name,
        })
        .from(costAnomalies)
        .innerJoin(tenants, eq(tenants.id, costAnomalies.tenantId))
        .orderBy(desc(costAnomalies.createdAt))
        .limit(20)
    ]);

    return NextResponse.json({ 
      success: true,
      data: {
        globalBudgets,
        tenantLimits,
        usageAlerts: usageAlertsRes,
        anomalies
      }
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[api/token-control] GET error:', err.message);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const raw = await request.json();
    const parsed = validateBody(tokenControlSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { action, data } = parsed.data;

    // ACTION: Update platform-wide service budget
    if (action === 'update_global_budget') {
      const d = data as Record<string, unknown>;
      const service = d['service'] as string;
      const monthly_budget_cents = d['monthly_budget_cents'] as number | undefined;
      const hard_cap_enabled = d['hard_cap_enabled'] as boolean | undefined;
      
      if (!service) return NextResponse.json({ error: 'Service name is required' }, { status: 400 });

      await db
        .insert(tokenBudgets)
        .values({
          service,
          monthlyBudgetCents: monthly_budget_cents ?? 0,
          hardCapEnabled: hard_cap_enabled ?? true,
          billingPeriod: sql`TO_CHAR(NOW(), 'YYYY-MM')`,
        })
        .onConflictDoUpdate({
          target: [tokenBudgets.service, tokenBudgets.billingPeriod],
          set: {
            monthlyBudgetCents: monthly_budget_cents ?? 0,
            hardCapEnabled: hard_cap_enabled ?? true,
            updatedAt: new Date(),
          },
        });
      
      return NextResponse.json({ success: true, message: `Updated ${service} global budget` });
    }

    // ACTION: Update limits for a specific tenant
    if (action === 'update_tenant_limit') {
      const d = data as Record<string, unknown>;
      const tenant_id = d['tenant_id'] as string;
      const limits = d;
      
      if (!tenant_id) return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });

      await db
        .insert(tenantTokenLimits)
        .values({
          tenantId: tenant_id,
          openaiMonthlyLimit: (limits['openai_monthly_limit'] as number) ?? -1,
          whatsappMonthlyMsgs: (limits['whatsapp_monthly_msgs'] as number) ?? -1,
          voiceMonthlyMins: (limits['voice_monthly_mins'] as number) ?? -1,
          contentMonthlyGen: (limits['content_monthly_gen'] as number) ?? -1,
          proposalMonthlyGen: (limits['proposal_monthly_gen'] as number) ?? -1,
          followupMonthlyCnt: (limits['followup_monthly_cnt'] as number) ?? -1,
          scoreMonthlyCnt: (limits['score_monthly_cnt'] as number) ?? -1,
          totalMonthlyCost: (limits['total_monthly_cost'] as number) ?? -1,
          setBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [tenantTokenLimits.tenantId],
          set: {
            openaiMonthlyLimit: (limits['openai_monthly_limit'] as number) ?? -1,
            whatsappMonthlyMsgs: (limits['whatsapp_monthly_msgs'] as number) ?? -1,
            voiceMonthlyMins: (limits['voice_monthly_mins'] as number) ?? -1,
            contentMonthlyGen: (limits['content_monthly_gen'] as number) ?? -1,
            proposalMonthlyGen: (limits['proposal_monthly_gen'] as number) ?? -1,
            followupMonthlyCnt: (limits['followup_monthly_cnt'] as number) ?? -1,
            scoreMonthlyCnt: (limits['score_monthly_cnt'] as number) ?? -1,
            totalMonthlyCost: (limits['total_monthly_cost'] as number) ?? -1,
            setBy: ctx.userId,
            updatedAt: new Date(),
          },
        });
      
      return NextResponse.json({ success: true, message: 'Updated tenant AI limits' });
    }

    // ACTION: Acknowledge an alert
    if (action === 'ack_alert') {
      const d = data as Record<string, unknown>;
      const alert_id = d['alert_id'] as string;
      if (!alert_id) return NextResponse.json({ error: 'alert_id is required' }, { status: 400 });

      await db
        .update(usageAlerts)
        .set({ 
          acknowledged: true, 
          acknowledgedBy: ctx.userId, 
          acknowledgedAt: new Date() 
        })
        .where(eq(usageAlerts.id, alert_id));
      
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[api/token-control] POST error:', err.message);
    return apiError(err);
  }
}

