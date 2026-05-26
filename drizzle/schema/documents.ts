/**
 * NuCRM - Document Management Schema
 *
 * Tables for document storage metadata and folder organization.
 */

import { pgTable, text, integer, jsonb, uuid, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';

// ── DOCUMENT FOLDERS ─────────────────────────────────────
export const documentFolders = pgTable('document_folders', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  metadata: jsonb('metadata').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: index('idx_document_folders_tenant').on(table.tenantId),
    parentIdx: index('idx_document_folders_parent').on(table.tenantId, table.parentId),
  };
});

// ── DOCUMENTS ────────────────────────────────────────────
export const documents = pgTable('documents', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  s3Key: text('s3_key').notNull(),
  s3Bucket: text('s3_bucket').notNull(),
  folderId: uuid('folder_id'),
  entityType: text('entity_type'), // 'contact' | 'deal' | 'company' | null
  entityId: text('entity_id'),
  uploadedBy: uuid('uploaded_by').notNull(),
  metadata: jsonb('metadata').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: index('idx_documents_tenant').on(table.tenantId),
    folderIdx: index('idx_documents_folder').on(table.tenantId, table.folderId),
    entityIdx: index('idx_documents_entity').on(table.tenantId, table.entityType, table.entityId),
    uploaderIdx: index('idx_documents_uploader').on(table.tenantId, table.uploadedBy),
  };
});
