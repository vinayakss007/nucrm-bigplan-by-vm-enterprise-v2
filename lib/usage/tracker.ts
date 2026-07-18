/**
 * Usage tracker — single source of truth for per-tenant resource counts and limits.
 *
 * Reads plan limits from the `plans` table (already exists in drizzle/schema/infra.ts)
 * and live counts from real CRM tables (not the daily `usage_snapshots` aggregate,
 * which would be stale).
 *
 * Writes a `limit_violations` row when a tenant exceeds a hard limit so that
 * super-admin dashboards and alert pipelines can pick it up.
 */
import { db } from '@/drizzle/db';
import {
  tenants,
  plans,
  contacts,
  leads,
  deals,
  forms,
  automations,
  tenantMembers,
  usageSnapshots,
  limitViolations,
} from '@/drizzle/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** Resource categories that map to columns on the `plans` table. */
export type LimitKind =
  | 'contacts'
  | 'leads'
  | 'deals'
  | 'users'
  | 'automations'
  | 'forms'
  | 'apiCallsDay'
  | 'storageGb';

export interface PlanLimits {
  maxContacts: number | null;
  maxDeals: number | null;
  maxUsers: number | null;
  maxAutomations: number | null;
  maxForms: number | null;
  maxApiCallsDay: number | null;
  maxStorageGb: number | null;
}

export interface UsageReport {
  kind: LimitKind;
  limit: number | null;
  actual: number;
  exceeded: boolean;
  remaining: number | null;
}

const NULL_LIMITS: PlanLimits = {
  maxContacts: null,
  maxDeals: null,
  maxUsers: null,
  maxAutomations: null,
  maxForms: null,
  maxApiCallsDay: null,
  maxStorageGb: null,
};

/**
 * Resolve the plan limits for a tenant. Returns `null`-filled limits if the
 * tenant has no plan or the plan row is missing — the caller should treat
 * that as "unlimited" (we never block on missing data).
 */
export async function getPlanLimits(tenantId: string): Promise<PlanLimits> {
  const row = await db
    .select({
      maxContacts: plans.maxContacts,
      maxDeals: plans.maxDeals,
      maxUsers: plans.maxUsers,
      maxAutomations: plans.maxAutomations,
      maxForms: plans.maxForms,
      maxApiCallsDay: plans.maxApiCallsDay,
      maxStorageGb: plans.maxStorageGb,
    })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const r = row[0];
  if (!r) return NULL_LIMITS;
  return {
    maxContacts: r.maxContacts ?? null,
    maxDeals: r.maxDeals ?? null,
    maxUsers: r.maxUsers ?? null,
    maxAutomations: r.maxAutomations ?? null,
    maxForms: r.maxForms ?? null,
    maxApiCallsDay: r.maxApiCallsDay ?? null,
    // numeric → string in pg; coerce to number
    maxStorageGb: r.maxStorageGb == null ? null : Number(r.maxStorageGb),
  };
}

/** Live count of a single resource for a tenant, respecting soft delete. */
export async function getCount(tenantId: string, kind: LimitKind): Promise<number> {
  switch (kind) {
    case 'contacts':
      return countWhere(contacts, contacts.tenantId, contacts.deletedAt, tenantId);
    case 'leads':
      return countWhere(leads, leads.tenantId, leads.deletedAt, tenantId);
    case 'deals':
      return countWhere(deals, deals.tenantId, deals.deletedAt, tenantId);
    case 'forms':
      return countWhere(forms, forms.tenantId, forms.deletedAt, tenantId);
    case 'automations':
      return countWhere(automations, automations.tenantId, automations.deletedAt, tenantId);
    case 'users': {
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.status, 'active')));
      return rows[0]?.c ?? 0;
    }
    case 'apiCallsDay': {
      // Pull from today's snapshot if present; otherwise 0. Calls are aggregated
      // by the cron writer, so live SUM would be heavy here.
      const today = todayDateString();
      const rows = await db
        .select({ c: usageSnapshots.apiCallsCount })
        .from(usageSnapshots)
        .where(and(eq(usageSnapshots.tenantId, tenantId), eq(usageSnapshots.snapshotDate, today)))
        .limit(1);
      return rows[0]?.c ?? 0;
    }
    case 'storageGb': {
      const today = todayDateString();
      const rows = await db
        .select({ mb: usageSnapshots.storageUsedMb })
        .from(usageSnapshots)
        .where(and(eq(usageSnapshots.tenantId, tenantId), eq(usageSnapshots.snapshotDate, today)))
        .limit(1);
      const mb = rows[0]?.mb;
      return mb == null ? 0 : Number(mb) / 1024;
    }
    default: {
      const _exhaustive: never = kind; void _exhaustive;
      return 0;
    }
  }
}

/** Compose the limit + actual count for a single kind. */
export async function getUsageReport(tenantId: string, kind: LimitKind): Promise<UsageReport> {
  const [plan, actual] = await Promise.all([
    getPlanLimits(tenantId),
    getCount(tenantId, kind),
  ]);
  const limit = limitFor(plan, kind);
  const exceeded = limit != null && actual >= limit;
  const remaining = limit == null ? null : Math.max(0, limit - actual);
  return { kind, limit, actual, exceeded, remaining };
}

/** Insert a `limit_violations` row. Idempotent-ish: skipped if an unresolved row already exists for today. */
export async function recordViolation(
  tenantId: string,
  kind: LimitKind,
  limit: number,
  actual: number,
): Promise<{ created: boolean }> {
  const violationType = `${kind}_exceeded`;
  // Look for an unresolved row created in the last 24 hours.
  const existing = await db
    .select({ id: limitViolations.id })
    .from(limitViolations)
    .where(
      and(
        eq(limitViolations.tenantId, tenantId),
        eq(limitViolations.violationType, violationType),
        eq(limitViolations.resolved, false),
        sql`${limitViolations.exceededAt} > now() - interval '24 hours'`,
      ),
    )
    .limit(1);
  if (existing[0]) return { created: false };

  await db.insert(limitViolations).values({
    tenantId,
    violationType,
    limitValue: limit,
    actualValue: actual,
  });
  return { created: true };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function limitFor(plan: PlanLimits, kind: LimitKind): number | null {
  switch (kind) {
    case 'contacts': return plan.maxContacts;
    case 'leads': return plan.maxContacts; // leads share the contact pool by default
    case 'deals': return plan.maxDeals;
    case 'users': return plan.maxUsers;
    case 'automations': return plan.maxAutomations;
    case 'forms': return plan.maxForms;
    case 'apiCallsDay': return plan.maxApiCallsDay;
    case 'storageGb': return plan.maxStorageGb;
  }
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function countWhere(
  table: unknown,
  tenantCol: AnyPgColumn,
  deletedCol: AnyPgColumn,
  tenantId: string,
): Promise<number> {
  // drizzle's `.from()` is generic over the table type; the helper is reused
  // for several tables so we cast through `any` to keep one implementation.
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    .where(and(eq(tenantCol, tenantId), isNull(deletedCol)));
  return rows[0]?.c ?? 0;
}
