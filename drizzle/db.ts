import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getPool } from '../lib/db/pool';
import * as schema from './schema';

export type DbClient = NodePgDatabase<typeof schema>;

let _db: DbClient | null = null;

export function getDb(): DbClient {
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

export const db: DbClient = new Proxy({} as DbClient, {
  get(_, prop) {
    const target = getDb();
    const value = target[prop as keyof DbClient];
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  }
});
