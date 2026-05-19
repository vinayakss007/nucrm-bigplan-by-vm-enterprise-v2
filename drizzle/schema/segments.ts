import { uniqueIndex, pgTable, uuid, text, timestamp, jsonb, index, integer } from 'drizzle-orm/pg-core';
import { tenants, users } from './core';
import * as utils from './utils';

// ── 1. DYNAMIC SEGMENTS (SMART LISTS) ────────────────
export const segments = pgTable('segments', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  entityType: text('entity_type').notNull(), // 'contact', 'deal', 'company', 'lead'
  
  // Rules for the segment (Systematic approach)
  // Store the UI builder state in 'config' and the compiled SQL/Filter in 'query_logic'
  config: jsonb('config').notNull().default({}),
  queryLogic: jsonb('query_logic').default({}),
  
  metadata: utils.metadata(),
  
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// Cache for segment members (to avoid re-running complex queries every time)
export const segmentMembers = pgTable('segment_members', {
  segmentId: uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull(),
  tenantId: utils.tenantId(),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    pk: index('idx_segment_members_pk').on(table.segmentId, table.entityId),
    tenantIdx: utils.tenantIdx(table),
  };
});
