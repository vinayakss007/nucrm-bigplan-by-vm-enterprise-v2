/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `documents` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  documentFolders,
  documents as documentRecords,
} from '../documents';
import {
  documents as storageDocuments,
} from '../files';

export const DOCUMENTS_TABLES = {

  // Document Management tables
  documentFolders: {
    table: documentFolders,
    metadata: {
      name: 'document_folders',
      schemaGroup: 'documents',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Hierarchical document folder structure',
      isCore: false,
      indexes: ['idx_document_folders_tenant', 'idx_document_folders_parent'],
    },
  },
  documentRecords: {
    table: documentRecords,
    metadata: {
      name: 'documents',
      schemaGroup: 'documents',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Document metadata records with folder organization',
      isCore: false,
      indexes: ['idx_documents_tenant', 'idx_documents_folder', 'idx_documents_entity', 'idx_documents_uploader'],
    },
  },
  storageDocuments: {
    table: storageDocuments,
    metadata: {
      name: 'documents',
      schemaGroup: 'documents',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Workspace file attachments in object storage',
      isCore: false,
      indexes: ['idx_documents_tenant', 'idx_documents_active', 'idx_documents_metadata_g', 'idx_files_link', 'idx_files_uploader'],
    },
  },
};
