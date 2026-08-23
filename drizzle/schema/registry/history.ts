/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `history` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  editHistory,
  fieldSnapshots,
} from '../history';

export const HISTORY_TABLES = {

  // History tables
  editHistory: {
    table: editHistory,
    metadata: {
      name: 'edit_history',
      schemaGroup: 'history',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Edit history for all entity types',
      isCore: false,
      indexes: [],
    },
  },
  fieldSnapshots: {
    table: fieldSnapshots,
    metadata: {
      name: 'field_snapshots',
      schemaGroup: 'history',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'editHistory'],
      description: 'Field-level snapshots for edit history',
      isCore: false,
      indexes: [],
    },
  },
};
