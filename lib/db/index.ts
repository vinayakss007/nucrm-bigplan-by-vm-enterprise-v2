/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
  buildInsert,
  buildUpdate,
  countRows,
} from './client';

// In-memory read-through cache (stampede-protected implementation)
export {
  dbCache,
  invalidateCache,
} from './cache';

// #3405 PR-3A: branded tenant-bound client (the choke point callers should use)
export { withTenantDb, type TenantDb } from './tenant-client';

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

// Pool mode assertion (#3506)
export {
  assertPoolMode,
  guardPoolMode,
  getPoolModeGuardStatus,
  resetPoolModeGuardStatus,
  isPgBouncerInUse,
  PoolModeInvariantError,
} from './pool-mode-guard';
