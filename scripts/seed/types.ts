/**
 * Shared types and utilities for seed modules.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../drizzle/schema';

export type SeedDb = NodePgDatabase<typeof schema>;

export interface SeedContext {
  db: SeedDb;
  IDS: typeof import('./ids').IDS;
}
