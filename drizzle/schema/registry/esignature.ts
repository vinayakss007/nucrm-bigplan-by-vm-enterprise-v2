/**
 * Table registry entries for the `esignature` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  signingRequests,
  signingEvents,
} from '../esignature';

export const ESIGNATURE_TABLES = {

  // Electronic Signature tables
  signingRequests: {
    table: signingRequests,
    metadata: {
      name: 'signing_requests',
      schemaGroup: 'esignature',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Electronic signature requests',
      isCore: false,
      indexes: ['idx_signing_requests_tenant', 'idx_signing_requests_document', 'idx_signing_requests_status', 'idx_signing_requests_external'],
    },
  },
  signingEvents: {
    table: signingEvents,
    metadata: {
      name: 'signing_events',
      schemaGroup: 'esignature',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'signingRequests'],
      description: 'Signature event audit trail',
      isCore: false,
      indexes: ['idx_signing_events_request', 'idx_signing_events_tenant', 'idx_signing_events_signer'],
    },
  },
};
