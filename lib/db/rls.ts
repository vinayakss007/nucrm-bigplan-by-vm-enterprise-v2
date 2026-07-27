/**
 * Row Level Security (RLS) Helper
 * Sets tenant context for database-enforced isolation
 *
 * IMPORTANT: PgBouncer is configured in transaction mode (pool_mode = transaction).
 * - When a `tx` is provided: uses is_local=true (transaction-scoped, clears at COMMIT)
 * - When no `tx` is provided: uses is_local=false (session-scoped, persists on the
 *   connection until PgBouncer reclaims it). PgBouncer's server_reset_query = 'DISCARD ALL'
 *   clears the GUC when the connection returns to the pool.
 *
 * This ensures the tenant GUC survives across multiple statements within one request
 * while never leaking to another request's connection checkout.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

/**
 * Set tenant context for RLS policies.
 *
 * Call sites:
 * - lib/auth/middleware.ts (6 sites) — no tx, session-scoped
 * - lib/tenant/context.ts (2 sites) — no tx, session-scoped
 * - lib/notifications.ts (via withTenantContext) — tx-scoped
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function setTenantContext(tenantId: string, userId: string, tx?: any): Promise<void> {
  if (!tenantId || !userId) {
    throw new Error('[RLS] setTenantContext called with empty tenantId or userId — refusing to set empty context');
  }
  try {
    const client = tx || db;
    // When tx is provided: is_local=true scopes to that transaction.
    // When tx is absent: is_local=false keeps the GUC for the connection's checkout.
    // PgBouncer's server_reset_query='DISCARD ALL' clears it on return to pool.
    const isLocal = tx ? sql`true` : sql`false`;
    await client.execute(
      sql`SELECT set_config('app.current_tenant', ${tenantId}, ${isLocal}), set_config('app.current_user', ${userId}, ${isLocal})`
    );
  } catch (error) {
    console.error('[RLS] Failed to set tenant context:', error);
    throw error;
  }
}

/**
 * Clear tenant context — call at end of request if needed for defence-in-depth.
 * Not strictly required when PgBouncer runs DISCARD ALL on connection return.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function clearTenantContext(tx?: any): Promise<void> {
  try {
    const client = tx || db;
    const isLocal = tx ? sql`true` : sql`false`;
    await client.execute(
      sql`SELECT set_config('app.current_tenant', '', ${isLocal}), set_config('app.current_user', '', ${isLocal})`
    );
  } catch (error) {
    console.error('[RLS] Failed to clear tenant context:', error);
  }
}

/**
 * Execute a function with tenant context inside one transaction.
 * The GUC is guaranteed to survive all statements in `fn`.
 */
export async function withTenantContext<T>(
  tenantId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (tx: any) => Promise<T>
): Promise<T> {
  if (!tenantId || !userId) {
    throw new Error('[RLS] withTenantContext called with empty tenantId or userId');
  }
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true), set_config('app.current_user', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Verify RLS is enabled on a table
 */
export async function verifyRLSEnabled(tableName: string): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = ${tableName}`
    );
    return (result.rows[0] as { rowsecurity?: boolean })?.rowsecurity ?? false;
  } catch (error) {
    console.error('[RLS] Failed to verify RLS status:', error);
    return false;
  }
}

/**
 * Verify all critical tables have RLS enabled
 */
export async function verifyAllRLSEnabled(): Promise<{ table: string; enabled: boolean }[]> {
  const criticalTables = [
    'contacts',
    'companies',
    'deals',
    'tasks',
    'activities',
    'notes',
    'meetings',
    'automations',
    'notifications',
    'webhook_deliveries',
    'api_keys',
    'audit_logs',
  ];

  const results = await Promise.all(
    criticalTables.map(async (table) => ({
      table,
      enabled: await verifyRLSEnabled(table),
    }))
  );

  return results;
}
