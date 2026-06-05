/**
 * Usage Tracker
 *
 * Tracks per-tenant and per-user resource usage (API calls, AI tokens,
 * storage, contacts, deals, etc.) and checks against plan limits.
 * Part of the modular SaaS infrastructure that enables different
 * tenants/use-cases to have different limits based on their plan.
 */
import { db } from '@/drizzle/db';
import { userUsage, planLimits } from '@/drizzle/schema/usage';
import { tenants } from '@/drizzle/schema/core';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Allowlist of valid custom metric names for JSONB counter storage.
 * Only these metrics can be used in the custom counter path to prevent
 * SQL injection via sql.raw().
 */
const VALID_CUSTOM_METRICS: readonly string[] = [
  'emails_sent',
  'sms_sent',
  'whatsapp_sent',
  'forms_submitted',
  'automations_triggered',
  'webhooks_sent',
  'reports_generated',
  'contacts_imported',
  'files_uploaded',
  'sequences_started',
  'ai_requests',
  'calls_made',
  'meetings_scheduled',
  'notes_created',
  'tasks_completed',
] as const;

export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number | null;
}

export interface UsageSummary {
  apiCallsToday: number;
  aiTokensToday: number;
  storageBytes: number;
  counters: Record<string, unknown>;
}

/**
 * Increment a usage metric for a user. If the user_usage row does not
 * exist, it is created. Supports daily-resetting metrics (api_calls, ai_tokens)
 * and cumulative metrics (storage_bytes, custom counters).
 */
export async function incrementUsage(
  tenantId: string,
  userId: string,
  metric: string,
  amount: number = 1
): Promise<void> {
  try {
    // Ensure the user_usage row exists
    await db
      .insert(userUsage)
      .values({
        tenantId,
        userId,
        lastActivityAt: new Date(),
      })
      .onConflictDoNothing();

    // Increment the appropriate metric
    switch (metric) {
      case 'api_calls':
        await db
          .update(userUsage)
          .set({
            apiCallsToday: sql`CASE WHEN api_calls_date = CURRENT_DATE THEN COALESCE(api_calls_today, 0) + ${amount} ELSE ${amount} END`,
            apiCallsDate: sql`CURRENT_DATE`,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(userUsage.tenantId, tenantId), eq(userUsage.userId, userId))
          );
        break;

      case 'ai_tokens':
        await db
          .update(userUsage)
          .set({
            aiTokensToday: sql`CASE WHEN ai_tokens_date = CURRENT_DATE THEN COALESCE(ai_tokens_today, 0) + ${amount} ELSE ${amount} END`,
            aiTokensDate: sql`CURRENT_DATE`,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(userUsage.tenantId, tenantId), eq(userUsage.userId, userId))
          );
        break;

      case 'storage_bytes':
        await db
          .update(userUsage)
          .set({
            storageBytes: sql`COALESCE(storage_bytes, 0) + ${amount}`,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(userUsage.tenantId, tenantId), eq(userUsage.userId, userId))
          );
        break;

      default:
        // Custom counter stored in the JSONB counters field.
        // Validate metric name against allowlist to prevent SQL injection via sql.raw().
        if (!VALID_CUSTOM_METRICS.includes(metric)) {
          console.warn(`[usage/tracker] Rejected invalid metric name: ${metric}`);
          return;
        }
        await db
          .update(userUsage)
          .set({
            counters: sql`jsonb_set(COALESCE(counters, '{}'), ${sql.raw(`'{${metric}}'`)}, to_jsonb(COALESCE((counters->>'${sql.raw(metric)}')::int, 0) + ${amount}))`,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(userUsage.tenantId, tenantId), eq(userUsage.userId, userId))
          );
        break;
    }
  } catch (error) {
    console.error('[usage/tracker] incrementUsage error:', error);
    // Non-fatal: usage tracking should not block operations
  }
}

/**
 * Check whether a tenant has reached a resource limit.
 * Returns whether the action is allowed, current usage, and the limit.
 */
export async function checkLimit(
  tenantId: string,
  resource: string
): Promise<LimitCheckResult> {
  try {
    // Get the tenant's plan
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { planId: true, currentUsers: true, currentContacts: true, currentDeals: true, storageUsedBytes: true },
    });

    if (!tenant) {
      return { allowed: false, current: 0, limit: 0 };
    }

    // Get plan limits
    const limits = await db.query.planLimits.findFirst({
      where: eq(planLimits.planId, tenant.planId),
    });

    // If no plan limits row exists, allow (unlimited)
    if (!limits) {
      return { allowed: true, current: 0, limit: null };
    }

    // Map resource to the correct limit and current value
    const resourceMap: Record<string, { current: number; limit: number | null }> = {
      users: {
        current: tenant.currentUsers ?? 0,
        limit: limits.maxUsers,
      },
      contacts: {
        current: tenant.currentContacts ?? 0,
        limit: limits.maxContacts,
      },
      deals: {
        current: tenant.currentDeals ?? 0,
        limit: limits.maxDeals,
      },
      storage_bytes: {
        current: tenant.storageUsedBytes ?? 0,
        limit: limits.maxStorageBytes,
      },
      api_calls_per_day: {
        current: 0, // Will be computed from aggregate below
        limit: limits.maxApiCallsPerDay,
      },
      ai_tokens_per_day: {
        current: 0,
        limit: limits.maxAiTokensPerDay,
      },
      emails_per_day: {
        current: 0,
        limit: limits.maxEmailsPerDay,
      },
      active_automations: {
        current: 0,
        limit: limits.maxActiveAutomations,
      },
      tickets: {
        current: 0,
        limit: limits.maxTickets,
      },
      forms: {
        current: 0,
        limit: limits.maxForms,
      },
      custom_fields_per_entity: {
        current: 0,
        limit: limits.maxCustomFieldsPerEntity,
      },
    };

    const entry = resourceMap[resource];
    if (!entry) {
      // Unknown resource - allow by default
      return { allowed: true, current: 0, limit: null };
    }

    // For daily metrics, aggregate from user_usage table
    if (resource === 'api_calls_per_day') {
      const [result] = await db
        .select({ total: sql<number>`COALESCE(SUM(CASE WHEN api_calls_date = CURRENT_DATE THEN api_calls_today ELSE 0 END), 0)` })
        .from(userUsage)
        .where(eq(userUsage.tenantId, tenantId));
      entry.current = Number(result?.total ?? 0);
    } else if (resource === 'ai_tokens_per_day') {
      const [result] = await db
        .select({ total: sql<number>`COALESCE(SUM(CASE WHEN ai_tokens_date = CURRENT_DATE THEN ai_tokens_today ELSE 0 END), 0)` })
        .from(userUsage)
        .where(eq(userUsage.tenantId, tenantId));
      entry.current = Number(result?.total ?? 0);
    }

    const limit = entry.limit;
    if (limit === null || limit === undefined) {
      return { allowed: true, current: entry.current, limit: null };
    }

    return {
      allowed: entry.current < limit,
      current: entry.current,
      limit,
    };
  } catch (error) {
    console.error('[usage/tracker] checkLimit error:', error);
    // On error, default to allowing the action
    return { allowed: true, current: 0, limit: null };
  }
}

/**
 * Get aggregated usage for an entire tenant.
 */
export async function getCurrentUsage(
  tenantId: string
): Promise<UsageSummary> {
  try {
    const [result] = await db
      .select({
        apiCallsToday: sql<number>`COALESCE(SUM(CASE WHEN api_calls_date = CURRENT_DATE THEN api_calls_today ELSE 0 END), 0)`,
        aiTokensToday: sql<number>`COALESCE(SUM(CASE WHEN ai_tokens_date = CURRENT_DATE THEN ai_tokens_today ELSE 0 END), 0)`,
        storageBytes: sql<number>`COALESCE(SUM(storage_bytes), 0)`,
      })
      .from(userUsage)
      .where(eq(userUsage.tenantId, tenantId));

    return {
      apiCallsToday: Number(result?.apiCallsToday ?? 0),
      aiTokensToday: Number(result?.aiTokensToday ?? 0),
      storageBytes: Number(result?.storageBytes ?? 0),
      counters: {},
    };
  } catch (error) {
    console.error('[usage/tracker] getCurrentUsage error:', error);
    return { apiCallsToday: 0, aiTokensToday: 0, storageBytes: 0, counters: {} };
  }
}

/**
 * Get usage for a specific user within a tenant.
 */
export async function getUserUsage(
  tenantId: string,
  userId: string
): Promise<UsageSummary> {
  try {
    const row = await db.query.userUsage.findFirst({
      where: and(eq(userUsage.tenantId, tenantId), eq(userUsage.userId, userId)),
    });

    if (!row) {
      return { apiCallsToday: 0, aiTokensToday: 0, storageBytes: 0, counters: {} };
    }

    // If the date has rolled over, daily counters are effectively 0
    const today = new Date().toISOString().split('T')[0];
    const apiCallsDate = row.apiCallsDate ? String(row.apiCallsDate) : null;
    const aiTokensDate = row.aiTokensDate ? String(row.aiTokensDate) : null;

    return {
      apiCallsToday: apiCallsDate === today ? (row.apiCallsToday ?? 0) : 0,
      aiTokensToday: aiTokensDate === today ? (row.aiTokensToday ?? 0) : 0,
      storageBytes: row.storageBytes ?? 0,
      counters: (row.counters as Record<string, unknown>) ?? {},
    };
  } catch (error) {
    console.error('[usage/tracker] getUserUsage error:', error);
    return { apiCallsToday: 0, aiTokensToday: 0, storageBytes: 0, counters: {} };
  }
}

/**
 * Reset daily counters for all users where the date has rolled over.
 * Called from a cron job at midnight.
 */
export async function resetDailyCounters(): Promise<void> {
  try {
    await db
      .update(userUsage)
      .set({
        apiCallsToday: 0,
        apiCallsDate: sql`CURRENT_DATE`,
        aiTokensToday: 0,
        aiTokensDate: sql`CURRENT_DATE`,
        updatedAt: new Date(),
      })
      .where(sql`api_calls_date < CURRENT_DATE OR ai_tokens_date < CURRENT_DATE`);
  } catch (error) {
    console.error('[usage/tracker] resetDailyCounters error:', error);
  }
}
