import { pgTable, text, uuid, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';
import { users } from './core';

export const dashboardLayouts = pgTable('dashboard_layouts', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Default'),
  layout: jsonb('layout').notNull().default([]),
  isDefault: boolean('is_default').default(false),
  source: text('source').notNull().default('user'),
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  userDefaultIdx: index('idx_dashboard_layouts_user_default').on(table.userId, table.isDefault),
}));
