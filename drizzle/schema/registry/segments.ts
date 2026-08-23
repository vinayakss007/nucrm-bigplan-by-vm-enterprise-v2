/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `segments` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  segments,
  segmentMembers,
} from '../segments';

export const SEGMENTS_TABLES = {

  // Segments tables
  segments: {
    table: segments,
    metadata: {
      name: 'segments',
      schemaGroup: 'segments',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Dynamic contact segments',
      isCore: false,
      indexes: ['idx_segments_tenant', 'idx_segments_metadata_g'],
    },
  },
  segmentMembers: {
    table: segmentMembers,
    metadata: {
      name: 'segment_members',
      schemaGroup: 'segments',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['segments', 'contacts', 'tenants'],
      description: 'Membership of contacts in segments',
      isCore: false,
      indexes: ['idx_segment_members_segment', 'idx_segment_members_contact', 'idx_segment_members_tenant'],
    },
  },
};
