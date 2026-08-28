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
