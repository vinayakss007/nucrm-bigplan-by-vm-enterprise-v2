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
