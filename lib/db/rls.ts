/**
 * Row Level Security (RLS) Helper
 * Sets tenant context for database-enforced isolation
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

/**
 * Set tenant context for RLS policies
 *
 * Uses is_local=true — settings are scoped to the current transaction only.
 */
export async function setTenantContext(tenantId: string, userId: string, tx?: any): Promise<void> {
  try {
    const client = tx || db;
    await client.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true), set_config('app.current_user', ${userId}, true)`);
  } catch (error) {
    console.error('[RLS] Failed to set tenant context:', error);
    throw error;
  }
}

/**
 * Clear tenant context
 */
export async function clearTenantContext(tx?: any): Promise<void> {
  try {
    const client = tx || db;
    await client.execute(sql`SELECT set_config('app.current_tenant', '', true), set_config('app.current_user', '', true)`);
  } catch (error) {
    console.error('[RLS] Failed to clear tenant context:', error);
  }
}

/**
 * Execute a function with tenant context.
 */
export async function withTenantContext<T>(
  tenantId: string,
  userId: string,
  fn: (tx: any) => Promise<T>
): Promise<T> {
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
    return (result.rows[0] as any)?.rowsecurity ?? false;
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
