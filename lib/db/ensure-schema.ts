import { query } from './client';

let checked = false;

/**
 * Checks if the DB schema is initialised.
 * Called from the health endpoint and app startup.
 * Returns { ready: boolean, missing_tables: string[] }
 */
export async function ensureSchema(): Promise<{ ready: boolean; missing: string[] }> {
  if (checked) return { ready: true, missing: [] };
  try {
    const REQUIRED = ['users','sessions','tenants','plans','contacts','deals','tasks','companies','activities','notifications'];
    const { rows } = await query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1)`,
      [REQUIRED]
    );
    const existing = rows.map(r => r.tablename);
    const missing = REQUIRED.filter(t => !existing.includes(t));
    if (missing.length === 0) checked = true;
    return { ready: missing.length === 0, missing };
  } catch (err: any) {
    return { ready: false, missing: ['db_connection_failed: ' + err.message] };
  }
}
