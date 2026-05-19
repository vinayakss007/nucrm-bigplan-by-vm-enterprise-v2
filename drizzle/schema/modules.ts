import { uniqueIndex, pgTable, uuid, text, timestamp, jsonb, index, boolean } from 'drizzle-orm/pg-core';
import { tenants, users } from './core';
import * as utils from './utils';

// ── 1. MODULE REGISTRY ────────────────────────────────
export const modules = pgTable('modules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull().default('1.0.0'),
  description: text('description'),
  category: text('category'),
  icon: text('icon'),
  isAvailable: text('is_available').default('false'),
  manifest: jsonb('manifest').default({}),
  ...utils.lifecycle(),
});

// ── 2. TENANT MODULE INSTALLATIONS ────────────────────
export const tenantModules = pgTable('tenant_modules', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'), // 'active', 'disabled'
  
  // Feature-level control (What the user can actually use)
  enabledFeatures: jsonb('enabled_features').default([]),
  forceEnabled: boolean('force_enabled').default(false), // super admin override
  
  settings: jsonb('settings').default({}),
  installedBy: uuid('installed_by').references(() => users.id, { onDelete: 'set null' }),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    uniqueInstallation: uniqueIndex('idx_tenant_modules_unique').on(table.tenantId, table.moduleId),
    tenantIdx: utils.tenantIdx(table),
  };
});
