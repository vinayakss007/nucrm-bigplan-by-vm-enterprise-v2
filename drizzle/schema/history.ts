import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';

export const editHistory = pgTable('edit_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  
  userId: uuid('user_id').notNull(),
  userName: text('user_name'),
  userEmail: text('user_email'),
  
  fieldName: text('field_name').notNull(),
  fieldLabel: text('field_label'),
  
  oldValue: text('old_value'),
  newValue: text('new_value'),
  
  changeType: text('change_type').notNull().default('update'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
}, (table) => {
  return {
    tenantIdx: index('idx_edit_history_tenant').on(table.tenantId),
    entityIdx: index('idx_edit_history_entity').on(table.entityType, table.entityId),
    userIdx: index('idx_edit_history_user').on(table.userId),
    createdIdx: index('idx_edit_history_created').on(table.createdAt),
  };
});

export const fieldSnapshots = pgTable('field_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  
  snapshotType: text('snapshot_type').notNull(),
  snapshotLabel: text('snapshot_label'),
  
  snapshotData: text('snapshot_data').notNull(),
  
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => {
  return {
    tenantIdx: index('idx_snapshots_tenant').on(table.tenantId),
    entityIdx: index('idx_snapshots_entity').on(table.entityType, table.entityId),
    expiresIdx: index('idx_snapshots_expires').on(table.expiresAt),
  };
});

export type EditHistory = typeof editHistory.$inferSelect;
export type FieldSnapshot = typeof fieldSnapshots.$inferSelect;