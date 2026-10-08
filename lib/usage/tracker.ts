/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Usage tracker — single source of truth for per-tenant resource counts and limits.
 *
 * Reads plan limits from the `plans` table (already exists in drizzle/schema/infra.ts)
 * and live counts from real CRM tables (not the daily `usage_snapshots` aggregate,
 * which would be stale).
 *
 * Every kind is measured from the table that owns the fact: rows for contacts,
 * leads, deals, forms, automations and members; `api_key_usage` for API calls;
 * `documents` + `file_attachments` for storage bytes. `usage_snapshots` is a
 * reporting/history table and no limit reads it — #2432.
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
  documents,
  fileAttachments,
  apiKeyUsage,
  limitViolations,
} from '@/drizzle/schema';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';

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
    maxContacts: toLimit(r.maxContacts),
    maxDeals: toLimit(r.maxDeals),
    maxUsers: toLimit(r.maxUsers),
    maxAutomations: toLimit(r.maxAutomations),
    maxForms: toLimit(r.maxForms),
    maxApiCallsDay: toLimit(r.maxApiCallsDay),
    // numeric arrives as a string from pg; toLimit coerces
    maxStorageGb: toLimit(r.maxStorageGb),
  };
}

/**
 * #2432: a plan cap is only meaningful after normalisation.
 *
 * `null` already meant unlimited here, but the plan editor renders any negative
 * as "Unlimited" (app/superadmin/billing/page.tsx:233 shows
 * `max_api_calls_day < 0 ? 'Unlimited'`). Kept verbatim, a `-1` would reach
 * `exceeded = actual >= -1` and lock a tenant out of exactly the resource the
 * operator was trying to unlimit — so negative and non-numeric both become null.
 */
function toLimit(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
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
      // #2432: `api_key_usage` is the ledger — lib/auth/api-key.ts inserts one
      // row per authenticated key request, so the counted event and the
      // enforced event are literally the same row. The old reader looked for a
      // `usage_snapshots` row dated today, and that column is
      // SUM(user_usage.api_calls_today) over a table nothing in this repo ever
      // writes, so it answered 0 for every tenant on every day.
      const startOfUtcDay = new Date();
      startOfUtcDay.setUTCHours(0, 0, 0, 0);
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(apiKeyUsage)
        .where(and(eq(apiKeyUsage.tenantId, tenantId), gte(apiKeyUsage.createdAt, startOfUtcDay)));
      return rows[0]?.c ?? 0;
    }
    case 'storageGb': {
      // #2432: live sum of the bytes the tenant currently holds, in GB.
      //
      // Exactly two tables receive upload rows: `documents` (written by
      // POST /api/tenant/documents) and `file_attachments` (written by
      // POST /api/tenant/files). `storage_documents` and `file_uploads` in
      // drizzle/schema/files.ts look like storage tables and have a size column
      // too, but no code path writes them — including them would only add
      // weight. Note that drizzle/schema/files.ts also exports a symbol named
      // `documents`; the barrel re-exports that one as `storageDocuments`, so
      // the `documents` imported above is the live table.
      //
      // Soft-deleted rows are excluded because the object is deleted eagerly on
      // delete (drizzle/schema/files.ts header) and the same predicate is what
      // counts every other resource here.
      const result = await db.execute<{ bytes: string | number | null }>(sql`
        SELECT coalesce(sum(bytes), 0) AS bytes FROM (
          SELECT ${documents.sizeBytes} AS bytes FROM ${documents}
            WHERE ${documents.tenantId} = ${tenantId} AND ${documents.deletedAt} IS NULL
          UNION ALL
          SELECT ${fileAttachments.fileSize} FROM ${fileAttachments}
            WHERE ${fileAttachments.tenantId} = ${tenantId} AND ${fileAttachments.deletedAt} IS NULL
        ) uploaded
      `);
      const bytes = Number(result.rows[0]?.bytes ?? 0);
      return bytes / 1024 ** 3;
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

async function countWhere(
  table: AnyPgTable,
  tenantCol: AnyPgColumn,
  deletedCol: AnyPgColumn,
  tenantId: string,
): Promise<number> {
  // The helper is reused for several tables, so the table is widened to
  // AnyPgTable and only the count expression is selected.
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(table)
    .where(and(eq(tenantCol, tenantId), isNull(deletedCol)));
  return rows[0]?.c ?? 0;
}
