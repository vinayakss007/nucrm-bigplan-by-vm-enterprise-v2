import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';

// ── Signing Requests ──────────────────────────────────
export const signingRequests = pgTable('signing_requests', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  documentId: uuid('document_id').notNull(),
  provider: text('provider').notNull().default('internal'), // 'docusign' | 'hellosign' | 'internal'
  status: text('status').notNull().default('pending'), // 'pending','sent','viewed','signed','declined','expired'
  externalId: text('external_id'),
  signers: jsonb('signers').default([]),
  metadata: jsonb('metadata').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    documentIdx: index('idx_signing_requests_document').on(table.documentId),
    statusIdx: index('idx_signing_requests_status').on(table.tenantId, table.status),
    externalIdx: index('idx_signing_requests_external').on(table.provider, table.externalId),
  };
});

// ── Signing Events ────────────────────────────────────
export const signingEvents = pgTable('signing_events', {
  id: utils.pk(),
  requestId: uuid('request_id').notNull().references(() => signingRequests.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  signerEmail: text('signer_email').notNull(),
  event: text('event').notNull(), // 'sent' | 'viewed' | 'signed' | 'declined'
  eventAt: timestamp('event_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata').default({}),
}, (table) => {
  return {
    requestIdx: index('idx_signing_events_request').on(table.requestId),
    tenantIdx: utils.tenantIdx(table),
    signerIdx: index('idx_signing_events_signer').on(table.signerEmail),
  };
});
