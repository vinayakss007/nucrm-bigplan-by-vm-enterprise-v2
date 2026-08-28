/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { query } from './client';

// Time-bounded cache: a successful check is trusted for this long before we
// re-query. This keeps the hot path fast while still eventually detecting a
// migration applied at runtime (a permanent boolean cache never re-detected it).
const SCHEMA_CHECK_TTL_MS = 60_000;

let lastOkAt = 0;

/**
 * Checks if the DB schema is initialised.
 * Called from the health endpoint and app startup.
 * Returns { ready: boolean, missing_tables: string[] }
 */
export async function ensureSchema(): Promise<{ ready: boolean; missing: string[] }> {
  if (lastOkAt !== 0 && Date.now() - lastOkAt < SCHEMA_CHECK_TTL_MS) {
    return { ready: true, missing: [] };
  }
  try {
    const REQUIRED = ['users','sessions','tenants','plans','contacts','deals','tasks','companies','activities','notifications'];
    const { rows } = await query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1)`,
      [REQUIRED]
    );
    const existing = rows.map(r => r.tablename);
    const missing = REQUIRED.filter(t => !existing.includes(t));
    // Only cache a healthy result; when tables are missing keep re-checking so a
    // later migration is picked up immediately.
    lastOkAt = missing.length === 0 ? Date.now() : 0;
    return { ready: missing.length === 0, missing };
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { ready: false, missing: ['db_connection_failed: ' + err.message] };
  }
}
