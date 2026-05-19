/**
 * Database Module Barrel Exports
 */

// Database client and query helpers
export {
  getPool,
  query,
  queryOne,
  queryMany,
  withTransaction,
  dbCache,
  invalidateCache,
  buildInsert,
  buildUpdate,
  countRows,
} from './client';

// Row Level Security helpers
export {
  setTenantContext,
  clearTenantContext,
  withTenantContext,
  verifyRLSEnabled,
  verifyAllRLSEnabled,
} from './rls';

// Schema validation
export {
  ensureSchema,
} from './ensure-schema';
