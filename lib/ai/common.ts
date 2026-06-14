import { db } from '@/drizzle/db';
import { 
  tokenBudgets, 
  tenantTokenLimits, 
  userTokenLimits, 
  apiKeysRegistry, 
  usageAlerts, 
  costAnomalies 
} from '@/drizzle/schema/tokens';
import { aiUsageAggregated, aiUsageLogs } from '@/drizzle/schema';
import { eq, and, sql, gt, lt, isNull } from 'drizzle-orm';

/**
 * Shared AI Utilities — Token Control & Usage Tracking
 * 
 * Every AI module MUST call checkTokenAndLimits() before making an API call
 * and recordUsage() after the call completes.
 * 
 * This ensures:
 *   - Global budgets are respected
 *   - Tenant limits are enforced
 *   - User limits are enforced
 *   - Anomalies are detected
 *   - Usage is tracked for billing
 *   - Alerts are triggered when thresholds are crossed
 */

// ── Token Check ──────────────────────────────────────────────────────────────

export interface TokenCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: {
    tenant_monthly?: number;
    user_daily?: number;
    global_budget?: number;
  };
}

/**
 * Check if an AI call is allowed before making it.
 * Call this BEFORE any OpenAI/WhatsApp/Voice API call.
 * 
 * @param tenantId - The tenant making the request
 * @param userId - The user making the request
 * @param module - Which AI module ('lead_scoring', 'whatsapp', 'voice', etc.)
 * @param service - Which external service ('openai', 'whatsapp', 'twilio', etc.)
 * @param estimatedCostCents - Estimated cost of this call (in paise)
 */
export async function checkTokenAndLimits(
  tenantId: string,
  userId: string,
  module: string,
  service: string,
  estimatedCostCents: number
): Promise<TokenCheckResult> {

  // 1. Check global budget
  const globalBudget = await getGlobalBudget(service);
  if (globalBudget.hardCapEnabled && globalBudget.monthlyBudgetCents > 0) {
    if (globalBudget.currentMonthCents >= globalBudget.monthlyBudgetCents) {
      return { allowed: false, reason: 'PLATFORM_BUDGET_EXHAUSTED' };
    }
    // Check soft cap alerts
    const pctUsed = (globalBudget.currentMonthCents / globalBudget.monthlyBudgetCents) * 100;
    if (pctUsed >= 100 && globalBudget.alertAt100pct) {
      await createAlert({
        alert_type: 'budget_100',
        target_type: 'platform',
        service,
        current_value: globalBudget.currentMonthCents,
        threshold_value: globalBudget.monthlyBudgetCents,
        message: `${service} budget exhausted (${formatCurrency(globalBudget.currentMonthCents)}/${formatCurrency(globalBudget.monthlyBudgetCents)})`,
      });
    } else if (pctUsed >= 80 && globalBudget.alertAt80pct) {
      // Only alert once per threshold crossing
      await checkAndAlertThreshold('platform', null, service, 'budget_80', globalBudget.currentMonthCents, globalBudget.monthlyBudgetCents);
    }
  }

  // 2. Check tenant limits
  const tenantLimits = await getTenantLimits(tenantId);
  if (tenantLimits) {
    const usage = await getTenantUsage(tenantId, module);
    const limit = getLimitForModule(tenantLimits, module);

    if (limit >= 0 && (usage.monthly_count ?? 0) >= limit) {
      return {
        allowed: false,
        reason: 'TENANT_LIMIT_EXCEEDED',
        remaining: { tenant_monthly: 0 },
      };
    }

    // Check total monthly cost limit
    if ((tenantLimits.totalMonthlyCost ?? -1) >= 0 && (usage.monthly_cost_cents ?? 0) >= (tenantLimits.totalMonthlyCost ?? 0)) {
      return {
        allowed: false,
        reason: 'TENANT_COST_LIMIT_EXCEEDED',
        remaining: { tenant_monthly: 0 },
      };
    }

    // Alert at 80% of tenant limit
    if (limit >= 0) {
      const pctUsed = ((usage.monthly_count ?? 0) / limit) * 100;
      if (pctUsed >= 80 && pctUsed < 85) { // Alert once around 80%
        await checkAndAlertThreshold('tenant', tenantId, module, 'tenant_80', usage.monthly_count ?? 0, limit);
      }
      if (pctUsed >= 100 && tenantLimits.hardCapAction === 'alert_only') {
        await createAlert({
          alert_type: 'tenant_limit_hit',
          target_type: 'tenant',
          target_id: tenantId,
          service: module,
          current_value: usage.monthly_count ?? undefined,
          threshold_value: limit,
          message: `Tenant hit ${module} limit: ${usage.monthly_count ?? 0}/${limit}. Action: ${tenantLimits.hardCapAction}`,
        });
      }
    }
  }

  // 3. Check user limits
  const userLimits = await getUserLimits(tenantId, userId, module);
  if (userLimits) {
    const dailyUsage = await getUserDailyUsage(tenantId, userId, module);
    if ((userLimits.dailyLimit ?? -1) >= 0 && dailyUsage.count >= (userLimits.dailyLimit ?? 0)) {
      return {
        allowed: false,
        reason: 'USER_DAILY_LIMIT_EXCEEDED',
        remaining: { user_daily: 0 },
      };
    }

    if ((userLimits.maxCostPerCall ?? -1) >= 0 && estimatedCostCents > (userLimits.maxCostPerCall ?? 0)) {
      return {
        allowed: false,
        reason: 'CALL_TOO_EXPENSIVE',
      };
    }
  }

  // All checks passed
  const tenantRemaining = tenantLimits ? getLimitForModule(tenantLimits, module) - ((await getTenantUsage(tenantId, module)).monthly_count ?? 0) : undefined;

  return {
    allowed: true,
    remaining: {
      tenant_monthly: tenantRemaining !== undefined && tenantRemaining >= 0 ? tenantRemaining : undefined,
      global_budget: globalBudget.monthlyBudgetCents > 0
        ? globalBudget.monthlyBudgetCents - globalBudget.currentMonthCents
        : undefined,
    },
  };
}

// ── Usage Recording ──────────────────────────────────────────────────────────

/**
 * Record usage AFTER a successful AI API call.
 * Call this with the ACTUAL cost (not estimated).
 */
export async function recordUsage(
  tenantId: string,
  userId: string,
  module: string,
  service: string,
  actualCostCents: number,
  tokensUsed: number = 0,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseData?: any
) {
  const currentPeriod = sql`TO_CHAR(NOW(), 'YYYY-MM')`;

  // 1. Update global budget
  await db.update(tokenBudgets)
    .set({
      currentMonthCents: sql`${tokenBudgets.currentMonthCents} + ${actualCostCents}`,
      updatedAt: new Date()
    })
    .where(and(
      eq(tokenBudgets.service, service),
      eq(tokenBudgets.billingPeriod, currentPeriod)
    ));

  // 2. Update tenant usage
  await db.insert(aiUsageAggregated)
    .values({
      tenantId,
      moduleName: module,
      billingPeriod: currentPeriod as unknown as string,
      count: 1,
      tokensUsed,
      costCents: actualCostCents,
    })
    .onConflictDoUpdate({
      target: [aiUsageAggregated.tenantId, aiUsageAggregated.moduleName, aiUsageAggregated.billingPeriod],
      set: {
        count: sql`${aiUsageAggregated.count} + 1`,
        tokensUsed: sql`${aiUsageAggregated.tokensUsed} + ${tokensUsed}`,
        costCents: sql`${aiUsageAggregated.costCents} + ${actualCostCents}`,
        updatedAt: new Date()
      }
    });

  // 3. Update api_keys_registry current spend
  await db.update(apiKeysRegistry)
    .set({
      currentMonthCents: sql`${apiKeysRegistry.currentMonthCents} + ${actualCostCents}`,
      lastUsedAt: new Date(),
      updatedAt: new Date()
    })
    .where(and(
      eq(apiKeysRegistry.service, service),
      eq(apiKeysRegistry.isPrimary, true),
      eq(apiKeysRegistry.isActive, true)
    ));

  // 4. Log individual call
  await db.insert(aiUsageLogs)
    .values({
      tenantId,
      userId,
      feature: module,
      model: service,
      tokensUsed,
      costCents: String(actualCostCents),
      metadata: responseData || {},
    });
}

// ── Anomaly Detection ────────────────────────────────────────────────────────

/**
 * Check if today's spending is unusually high for this tenant.
 * Call after recording usage.
 */
export async function checkForAnomaly(
  tenantId: string,
  service: string,
  _costCents: number
): Promise<{ anomaly: boolean; severity: 'low' | 'medium' | 'high' } | null> {
  // Get average daily spend for this tenant over last 7 days
  const dailySpend = db.select({
    dailyCost: sql<number>`SUM(${aiUsageLogs.costCents})`.as('daily_cost')
  })
  .from(aiUsageLogs)
  .where(and(
    eq(aiUsageLogs.tenantId, tenantId),
    eq(aiUsageLogs.model, service),
    gt(aiUsageLogs.createdAt, sql`NOW() - INTERVAL '7 days'`),
    lt(aiUsageLogs.createdAt, sql`NOW() - INTERVAL '1 day'`)
  ))
  .groupBy(sql`DATE(${aiUsageLogs.createdAt})`)
  .as('daily');

  const avgResults = await db.select({
    avgDaily: sql<number>`COALESCE(AVG(${dailySpend.dailyCost}), 0)`
  })
  .from(dailySpend);

  const avgDaily = Number(avgResults[0]?.avgDaily || 0);
  if (avgDaily === 0) return null; // No history yet

  const todayResults = await db.select({
    todayTotal: sql<number>`SUM(${aiUsageLogs.costCents})`
  })
  .from(aiUsageLogs)
  .where(and(
    eq(aiUsageLogs.tenantId, tenantId),
    eq(aiUsageLogs.model, service),
    gt(aiUsageLogs.createdAt, sql`NOW()::date`)
  ));

  const todayTotal = Number(todayResults[0]?.todayTotal || 0);
  const deviation = avgDaily > 0 ? ((todayTotal - avgDaily) / avgDaily) * 100 : 0;

  if (deviation > 500) {
    // More than 5x normal — HIGH severity
    await db.insert(costAnomalies)
      .values({
        tenantId,
        service,
        expectedDailyCents: Math.round(avgDaily),
        actualDailyCents: todayTotal,
        deviationPct: String(Math.round(deviation)),
        suspectedCause: 'bulk_usage',
        actionTaken: 'alerted'
      });

    await createAlert({
      alert_type: 'spike_detected',
      target_type: 'tenant',
      target_id: tenantId,
      service,
      current_value: todayTotal,
      threshold_value: Math.round(avgDaily),
      message: `${service} spending ${deviation.toFixed(0)}% above average (₹${formatCurrency(todayTotal)} vs ₹${formatCurrency(Math.round(avgDaily))})`,
    });

    return { anomaly: true, severity: 'high' };
  }

  if (deviation > 200) {
    // More than 2x normal — MEDIUM severity
    await db.insert(costAnomalies)
      .values({
        tenantId,
        service,
        expectedDailyCents: Math.round(avgDaily),
        actualDailyCents: todayTotal,
        deviationPct: String(Math.round(deviation)),
        suspectedCause: 'elevated_usage'
      });

    return { anomaly: true, severity: 'medium' };
  }

  return null;
}

// ── Helper Functions ─────────────────────────────────────────────────────────

async function getGlobalBudget(service: string) {
  const result = await db.query.tokenBudgets.findFirst({
    where: and(
      eq(tokenBudgets.service, service),
      eq(tokenBudgets.billingPeriod, sql`TO_CHAR(NOW(), 'YYYY-MM')`)
    )
  });

  const fallback: typeof tokenBudgets.$inferSelect = {
    id: '',
    service,
    monthlyBudgetCents: 0,
    currentMonthCents: 0,
    hardCapEnabled: true,
    alertAt50pct: true,
    alertAt80pct: true,
    alertAt100pct: true,
    softCapEnabled: true,
    billingPeriod: '',
    resetDay: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  return result || fallback;
}

async function getTenantLimits(tenantId: string) {
  return db.query.tenantTokenLimits.findFirst({
    where: eq(tenantTokenLimits.tenantId, tenantId)
  });
}

async function getTenantUsage(tenantId: string, module: string) {
  const result = await db.query.aiUsageAggregated.findFirst({
    where: and(
      eq(aiUsageAggregated.tenantId, tenantId),
      eq(aiUsageAggregated.moduleName, module),
      eq(aiUsageAggregated.billingPeriod, sql`TO_CHAR(NOW(), 'YYYY-MM')`)
    )
  });

  return result ? { 
    monthly_count: result.count ?? 0, 
    monthly_cost_cents: result.costCents ?? 0 
  } : { monthly_count: 0, monthly_cost_cents: 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLimitForModule(limits: any, module: string): number {
  const map: Record<string, number> = {
    'lead_scoring': limits.scoreMonthlyCnt,
    'revenue_agent': limits.followupMonthlyCnt,
    'whatsapp_agent': limits.whatsappMonthlyMsgs,
    'voice_agent': limits.voiceMonthlyMins,
    'content_gen': limits.contentMonthlyGen,
    'proposals': limits.proposalMonthlyGen,
  };
  return map[module] ?? -1;
}

async function getUserLimits(tenantId: string, userId: string, module: string) {
  return db.query.userTokenLimits.findFirst({
    where: and(
      eq(userTokenLimits.tenantId, tenantId),
      eq(userTokenLimits.userId, userId),
      eq(userTokenLimits.module, module)
    )
  });
}

async function getUserDailyUsage(tenantId: string, userId: string, module: string) {
  const results = await db.select({
    count: sql<number>`COUNT(*)`
  })
  .from(aiUsageLogs)
  .where(and(
    eq(aiUsageLogs.tenantId, tenantId),
    eq(aiUsageLogs.userId, userId),
    eq(aiUsageLogs.feature, module),
    gt(aiUsageLogs.createdAt, sql`NOW()::date`)
  ));

  return { count: Number(results[0]?.count || 0) };
}

async function createAlert(data: {
  alert_type: string;
  target_type: string;
  target_id?: string;
  service?: string;
  current_value?: number;
  threshold_value?: number;
  message: string;
}) {
  // Check if similar alert was created in last hour (avoid spam)
  const existing = await db.query.usageAlerts.findFirst({
    where: and(
      eq(usageAlerts.alertType, data.alert_type),
      eq(usageAlerts.targetType, data.target_type),
      data.target_id ? eq(usageAlerts.targetId, data.target_id) : isNull(usageAlerts.targetId),
      gt(usageAlerts.createdAt, sql`NOW() - INTERVAL '1 hour'`)
    )
  });

  if (existing) return; // Already alerted

  await db.insert(usageAlerts)
    .values({
      alertType: data.alert_type,
      targetType: data.target_type,
      targetId: data.target_id,
      service: data.service,
      currentValue: data.current_value,
      thresholdValue: data.threshold_value,
      message: data.message,
      notificationSent: 'in_app'
    });
}

async function checkAndAlertThreshold(
  targetType: string,
  targetId: string | null,
  service: string,
  alertType: string,
  currentValue: number,
  thresholdValue: number
) {
  const existing = await db.query.usageAlerts.findFirst({
    where: and(
      eq(usageAlerts.alertType, alertType),
      eq(usageAlerts.targetType, targetType),
      targetId ? eq(usageAlerts.targetId, targetId) : isNull(usageAlerts.targetId),
      gt(usageAlerts.createdAt, sql`NOW() - INTERVAL '6 hours'`)
    )
  });

  if (!existing) {
    await createAlert({
      alert_type: alertType,
      target_type: targetType,
      target_id: targetId || undefined,
      service,
      current_value: currentValue,
      threshold_value: thresholdValue,
      message: `${targetType} ${targetId || 'platform'} reached ${((currentValue / thresholdValue) * 100).toFixed(0)}% of ${service} limit`,
    });
  }
}

function formatCurrency(cents: number): string {
  return `₹${(cents / 100).toLocaleString('en-IN')}`;
}
