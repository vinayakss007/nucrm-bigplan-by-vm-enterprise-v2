import { pgTable, uuid, text, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import * as utils from './utils';

export const customEntities = pgTable('custom_entities', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  fields: jsonb('fields').notNull().default([]),
  settings: jsonb('settings').notNull().default('{}'),
  isActive: boolean('is_active').default(true),
  ...utils.lifecycle(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  slugIdx: index('idx_custom_entities_slug').on(table.tenantId, table.slug),
  activeIdx: utils.activeIdx(table),
}));

export const customEntitiesRelations = relations(customEntities, ({ many }) => ({
  rows: many(customEntityData),
}));

export const customEntityData = pgTable('custom_entity_data', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityId: uuid('entity_id').notNull().references(() => customEntities.id, { onDelete: 'cascade' }),
  data: jsonb('data').notNull().default('{}'),
  ...utils.lifecycle(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  entityIdx: index('idx_custom_entity_data_entity').on(table.tenantId, table.entityId),
  dataGinIdx: index('idx_custom_entity_data_gin').using('gin', table.data),
}));

export const customEntityDataRelations = relations(customEntityData, ({ one }) => ({
  entity: one(customEntities, {
    fields: [customEntityData.entityId],
    references: [customEntities.id],
  }),
}));
