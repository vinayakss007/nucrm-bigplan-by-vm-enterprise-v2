/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { devLogger } from '@/lib/dev-logger';
import { AsyncLocalStorage } from 'async_hooks';
import { getPool as _getPool } from './pool';

// Re-export getPool from the new location
export const getPool = _getPool;

// Request-scoped transaction storage
// Ensures all queries in a request use the same transaction/connection
export const transactionStorage = new AsyncLocalStorage<PoolClient>();

function sleep(ms: number) {
  return new Promise<void>(r => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
}
const RETRYABLE = ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','40001','40P01','08006','08001'];
function isRetryable(e: unknown) {
  const err = e as { message?: string; code?: string } | null | undefined;
  return RETRYABLE.some(c => err?.message?.includes(c) || err?.code === c);
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[], retries = 2): Promise<QueryResult<T>> {
  // Check if we are inside a withTransaction block
  const clientFromStorage = transactionStorage.getStore();
  
  const startTime = Date.now();
  try {
    const result = clientFromStorage 
      ? await clientFromStorage.query<T>(sql, params)
      : await getPool().query<T>(sql, params);
      
    const duration = Date.now() - startTime;
    
    // Log query in development
    if (process.env.NODE_ENV === 'development') {
      devLogger.query(sql, duration, params);
    }
    
    return result;
  }
  catch (err: unknown) {
    const _duration = Date.now() - startTime;
    // Only retry if NOT in a transaction
    if (!clientFromStorage && retries > 0 && isRetryable(err)) { 
      await sleep(150 * Math.pow(2, 2-retries)); 
      return query(sql, params, retries-1); 
    }
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error('[db] query error:', errMessage, '|', sql.slice(0,120));
    
    // Log error in development
    if (process.env.NODE_ENV === 'development') {
      devLogger.error(err as Error, 'Database Query', undefined);
    }
    
    throw err;
  }
}
export async function queryOne<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T|null> {
  return (await query<T>(sql, params)).rows[0] ?? null;
}
export async function queryMany<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await query<T>(sql, params)).rows;
}
export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  // If already in a transaction, just reuse it
  const existingClient = transactionStorage.getStore();
  if (existingClient) {
    return fn(existingClient);
  }

  const client = await getPool().connect();
  let rollbackFailed = false;
  try { 
    await client.query('BEGIN'); 
    // Run the function within the AsyncLocalStorage scope
    const r = await transactionStorage.run(client, () => fn(client)); 
    await client.query('COMMIT'); 
    return r; 
  }
  catch (err) { 
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback failed: connection state is unknown (e.g. terminated backend),
      // so it must be destroyed instead of returned to the pool for reuse.
      rollbackFailed = true;
      throw err;
    }
    throw err; 
  }
  finally { 
    client.release(rollbackFailed);
  }
}

// ── In-process read-through cache ────────────────────────────
// The cache implementation (with stampede protection) lives in ./cache.
// Import { dbCache, invalidateCache } from '@/lib/db/cache' (or the barrel
// '@/lib/db'). It is intentionally not re-defined here to avoid a second,
// unprotected copy of the cache.

const PROTECTED = new Set(['id','created_at','is_super_admin',
  'password_hash','totp_secret','totp_backup_codes','totp_enabled','email_verified','role_slug']);

// Whitelist of valid table names to prevent SQL injection
const VALID_TABLES = new Set([
  'users','contacts','leads','deals','companies','tasks','api_keys','roles',
  'tenant_members','tenants','plans','subscriptions','webhooks','webhook_deliveries',
  'webhook_inbound_logs','audit_logs','email_templates','email_sequences',
  'automation_rules','automation_runs','automation_steps','notifications',
  'sessions','refresh_tokens','invitations','file_uploads','tags',
  'contact_tags','lead_tags','deal_stages','pipeline_stages','custom_fields',
  'activities','activity_logs','notes','attachments','integrations','queue_jobs',
  'support_tickets', 'ticket_replies', 'error_logs', 'onboarding_progress',
  'email_verifications', 'active_impersonation_sessions'
]);

function validateTableName(table: string): string {
  if (!VALID_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}. Table names must be from the whitelist.`);
  }
  return table;
}

 
 
export function buildInsert(table: string, data: Record<string, unknown>) {
  const validTable = validateTableName(table);
  const keys = Object.keys(data).filter(k => !PROTECTED.has(k));
  if (!keys.length) throw new Error('buildInsert: no fields');
  return {
    sql: `INSERT INTO public.${validTable} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,
    values: keys.map(k=>data[k]),
  };
}

 
 
export function buildUpdate(table: string, data: Record<string, unknown>, where: Record<string, unknown>) {
  const validTable = validateTableName(table);
  const dk = Object.keys(data).filter(k => data[k] !== undefined && !PROTECTED.has(k));
  if (!dk.length) throw new Error('buildUpdate: no fields');
  const wk = Object.keys(where);
  let i = 1;
  return {
    sql: `UPDATE public.${validTable} SET ${dk.map(k=>`"${k}"=$${i++}`).join(',')}, updated_at=now() WHERE ${wk.map(k=>`"${k}"=$${i++}`).join(' AND ')} RETURNING *`,
    values: [...dk.map(k=>data[k]), ...wk.map(k=>where[k])],
  };
}
 
 
export async function countRows(table: string, where: Record<string, unknown>): Promise<number> {
  // FIX CRITICAL-06: Add table name validation (was missing unlike buildInsert/buildUpdate)
  const validTable = validateTableName(table);
  const keys = Object.keys(where);
  const r = await query<{count:string}>(`SELECT count(*)::int as count FROM public.${validTable} WHERE ${keys.map((k,i)=>`"${k}"=$${i+1}`).join(' AND ')}`, keys.map(k=>where[k]));
  return parseInt(r.rows[0]?.count ?? '0', 10);
}
