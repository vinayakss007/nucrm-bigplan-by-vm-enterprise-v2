import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { getPool } from '../lib/db/pool';
import { getPinnedClient } from '../lib/db/request-connection';
import * as schema from './schema';

export type DbClient = NodePgDatabase<typeof schema>;

let _db: DbClient | null = null;

export function getDb(): DbClient {
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

/**
 * Cache of per-PoolClient drizzle instances so we don't rebuild the wrapper on
 * every property access while a connection is pinned. Keyed weakly by the
 * client object so entries are collected when the client is GC'd.
 */
const clientDbCache = new WeakMap<PoolClient, DbClient>();

/**
 * Return a drizzle instance bound to a single pinned PoolClient (#1615).
 * Building on the pinned client (instead of the pool) is what gives the
 * request's queries connection affinity, so the SESSION-scoped tenant GUC set
 * by setTenantContext() is visible to every subsequent query in the request.
 */
function getClientDb(client: PoolClient): DbClient {
  let clientDb = clientDbCache.get(client);
  if (!clientDb) {
    clientDb = drizzle(client, { schema });
    clientDbCache.set(client, clientDb);
  }
  return clientDb;
}

/**
 * Resolve the drizzle instance for the current async context: the pinned
 * client's instance when a connection is pinned for this request (see
 * lib/db/request-connection.ts), otherwise the shared pool-bound instance.
 * This preserves existing behavior for any path with no pinned connection
 * (background jobs, workers, tests that construct their own pool).
 */
function resolveDb(): DbClient {
  const pinned = getPinnedClient();
  return pinned ? getClientDb(pinned) : getDb();
}

export const db: DbClient = new Proxy({} as DbClient, {
  get(_, prop) {
    const target = resolveDb();
    const value = target[prop as keyof DbClient];
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  }
});
