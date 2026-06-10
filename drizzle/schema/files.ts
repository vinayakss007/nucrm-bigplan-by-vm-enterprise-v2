/**
 * `documents` — workspace file attachments.
 *
 * Each row is a record-keeping entry for a file the tenant has uploaded
 * to object storage (S3 / R2). The actual bytes live at `storageKey`;
 * the column tracks display metadata, the polymorphic record this file
 * is attached to (a contact, a deal, etc., via `linkedEntityType` /
 * `linkedEntityId`), and lifecycle.
 *
 * Soft delete via `deletedAt`. The S3 object is removed eagerly on
 * delete; the metadata row is kept so audit trails stay intact.
 */
import { pgTable, text, index, uuid, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './core';
import * as utils from './utils';

export const documents = pgTable(
  'documents',
  {
    id: utils.pk(),
    tenantId: utils.tenantId(),

    /** Display name shown in the UI; defaults to the original filename. */
    name: text('name').notNull(),

    /**
     * Object-storage key, e.g. `documents/<tenantId>/<uuid>.pdf`.
     * Together with the configured S3 bucket this is enough to fetch
     * the bytes via presigned URL.
     */
    storageKey: text('storage_key').notNull().unique(),

    /** MIME type as advertised by the browser at upload time. */
    mimeType: text('mime_type').notNull(),

    /** Bytes; bigint because uploads can exceed 2GB. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),

    /** Free-form description shown in the document detail panel. */
    description: text('description'),

    /** Tags for grouping (matches the `contacts.tags` shape). */
    tags: text('tags').array().default(sql`'{}'`),

    /**
     * Polymorphic link. `entityType` is the table name in lowercase
     * singular ('contact', 'deal', 'company', 'lead', 'ticket').
     * Both columns are nullable so a document can also exist
     * unattached at the workspace level.
     */
    linkedEntityType: text('linked_entity_type'),
    linkedEntityId: uuid('linked_entity_id'),

    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),

    metadata: utils.metadata(),

    ...utils.lifecycle(),
  },
  (table) => ({
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
    linkIdx: index('idx_storage_docs_link').on(table.linkedEntityType, table.linkedEntityId),
    uploaderIdx: index('idx_storage_docs_uploader').on(table.uploadedBy),
  }),
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
