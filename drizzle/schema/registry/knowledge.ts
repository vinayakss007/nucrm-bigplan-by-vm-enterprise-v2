/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `knowledge` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  kbCategories,
  kbArticles,
} from '../knowledge';

export const KNOWLEDGE_TABLES = {

  // Knowledge Base tables
  kbCategories: {
    table: kbCategories,
    metadata: {
      name: 'kb_categories',
      schemaGroup: 'knowledge',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Knowledge base categories',
      isCore: false,
      indexes: ['idx_kb_categories_tenant', 'idx_kb_categories_slug', 'idx_kb_categories_active'],
    },
  },
  kbArticles: {
    table: kbArticles,
    metadata: {
      name: 'kb_articles',
      schemaGroup: 'knowledge',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'kbCategories'],
      description: 'Knowledge base articles',
      isCore: false,
      indexes: ['idx_kb_articles_tenant', 'idx_kb_articles_category', 'idx_kb_articles_status', 'idx_kb_articles_slug', 'idx_kb_articles_search', 'idx_kb_articles_active', 'idx_kb_articles_metadata_g'],
    },
  },
};
