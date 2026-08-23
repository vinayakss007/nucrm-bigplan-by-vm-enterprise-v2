/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tenant Isolation Guard
 *
 * Development/test utility that verifies all database queries include
 * tenant_id filtering. Catches accidental cross-tenant data leaks at
 * query time rather than in production.
 *
 * Problem:
 * In a multi-tenant app, forgetting a WHERE tenant_id = ? clause means
 * one tenant can see another's data. This is the #1 multi-tenant security
 * bug and is extremely hard to catch in code review.
 *
 * Solution:
 * Wrap the query executor in development/test mode. When a query touches
 * a tenant-scoped table without a tenant_id filter, it logs a warning
 * (or throws, depending on strictness).
 *
 * Usage:
 * ```ts
 * import { assertTenantScoped } from '@/lib/db/tenant-isolation-guard';
 *
 * // In development mode (enabled via NODE_ENV or feature flag):
 * assertTenantScoped(sql, 'contacts'); // throws if no tenant_id found
 * ```
 *
 * For automated testing:
 * ```ts
 * import { findUnfilteredQueries } from '@/lib/db/tenant-isolation-guard';
 *
 * const violations = findUnfilteredQueries(queryLog);
 * expect(violations).toEqual([]);
 * ```
 */

/**
 * Tables that MUST always be filtered by tenant_id.
 * Queries to these tables without tenant_id are potential data leaks.
 */
export const TENANT_SCOPED_TABLES = [
  'contacts',
  'companies',
  'deals',
  'deal_products',
  'leads',
  'tasks',
  'activities',
  'notes',
  'users',
  'team_members',
  'teams',
  'custom_field_defs',
  'documents',
  'document_folders',
  'email_templates',
  'email_sequences',
  'sequence_enrollments',
  'webhooks',
  'webhook_deliveries',
  'audit_logs',
  'api_keys',
  'automation_rules',
  'assignment_rules',
  'canned_responses',
  'calls',
  'sms_messages',
  'invoices',
  'invoice_line_items',
  'payments',
  'subscriptions',
  'products',
  'pipelines',
  'pipeline_stages',
  'reports',
  'scheduled_reports',
  'notifications',
  'kb_articles',
  'kb_categories',
  'tickets',
  'ticket_comments',
  'forms',
  'form_submissions',
] as const;

export type TenantScopedTable = typeof TENANT_SCOPED_TABLES[number];

/**
 * Tables that are legitimately global (not scoped to a tenant).
 */
export const GLOBAL_TABLES = [
  'tenants',
  'plans',
  'feature_registry',
  'migrations',
  'usage_snapshots',
  'failed_webhooks',
  'system_settings',
] as const;

export interface IsolationViolation {
  /** The SQL query (or fragment) that violated isolation */
  query: string;
  /** The table(s) that were accessed without tenant_id filter */
  tables: string[];
  /** Timestamp of the violation */
  timestamp: number;
}

/**
 * Check if a SQL query string contains tenant_id filtering for the given table.
 *
 * This is a heuristic check — it looks for `tenant_id` in the WHERE clause
 * context. It's not a full SQL parser but catches the vast majority of cases.
 *
 * @param sql - The SQL query string
 * @param table - The table being queried
 * @returns true if the query appears to be tenant-scoped
 */
export function hasTenantFilter(sql: string, table: string): boolean {
  // Normalize whitespace for easier matching
  const normalized = sql.toLowerCase().replace(/\s+/g, ' ');

  // Check if this table is even referenced
  if (!normalized.includes(table.replace(/_/g, '_'))) {
    return true; // Table not in query — not our concern
  }

  // Look for tenant_id in the query
  if (normalized.includes('tenant_id')) return true;
  if (normalized.includes('tenantid')) return true;
  if (normalized.includes('"tenant_id"')) return true;

  // Special cases that are safe:
  // - INSERT (has tenant_id in VALUES)
  if (normalized.trimStart().startsWith('insert')) return true;
  // - CREATE TABLE / ALTER TABLE
  if (normalized.trimStart().startsWith('create ')) return true;
  if (normalized.trimStart().startsWith('alter ')) return true;
  // - Subqueries with tenant_id anywhere
  if (normalized.includes('tenant')) return true;

  return false;
}

/**
 * Assert that a query is tenant-scoped. Throws in strict mode, logs in lenient mode.
 *
 * @param sql - The SQL query
 * @param table - The table being queried
 * @param strict - If true, throws an error. If false, logs a warning. Default: false.
 */
export function assertTenantScoped(sql: string, table: string, strict = false): void {
  // Only check tenant-scoped tables
  const isTenantTable = TENANT_SCOPED_TABLES.includes(table as TenantScopedTable);
  if (!isTenantTable) return;

  if (!hasTenantFilter(sql, table)) {
    const message = `[TENANT ISOLATION] Query accesses '${table}' without tenant_id filter: ${sql.slice(0, 200)}`;

    if (strict) {
      throw new Error(message);
    }

    console.warn(message);
  }
}

/**
 * Scan a log of queries and return any that violate tenant isolation.
 * Useful for integration tests that replay a sequence of queries and
 * verify none leak data across tenants.
 *
 * @param queries - Array of { sql, table? } objects
 * @returns Array of violations found
 */
export function findUnfilteredQueries(
  queries: Array<{ sql: string; table?: string }>,
): IsolationViolation[] {
  const violations: IsolationViolation[] = [];

  for (const q of queries) {
    const violatedTables: string[] = [];

    if (q.table) {
      // Single table provided
      if (TENANT_SCOPED_TABLES.includes(q.table as TenantScopedTable)) {
        if (!hasTenantFilter(q.sql, q.table)) {
          violatedTables.push(q.table);
        }
      }
    } else {
      // Check against all tenant-scoped tables mentioned in the query
      const normalizedSql = q.sql.toLowerCase();
      for (const table of TENANT_SCOPED_TABLES) {
        if (normalizedSql.includes(table) && !hasTenantFilter(q.sql, table)) {
          violatedTables.push(table);
        }
      }
    }

    if (violatedTables.length > 0) {
      violations.push({
        query: q.sql.slice(0, 500),
        tables: violatedTables,
        timestamp: Date.now(),
      });
    }
  }

  return violations;
}
