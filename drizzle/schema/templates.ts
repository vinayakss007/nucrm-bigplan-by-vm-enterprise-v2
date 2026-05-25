import { pgTable, uuid, text, timestamp, jsonb, boolean, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from './core';
import * as utils from './utils';

// ── 1. PRODUCT TEMPLATES ──────────────────────────────
export const productTemplates = pgTable('product_templates', {
  id: utils.pk(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  description: text('description'),
  icon: text('icon'),
  modules: jsonb('modules').default([]),
  customFields: jsonb('custom_fields').default([]),
  pipelines: jsonb('pipelines').default([]),
  automations: jsonb('automations').default([]),
  isBuiltin: boolean('is_builtin').default(false),
  status: text('status').notNull().default('active'), // active, draft, archived
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  tenantCount: integer('tenant_count').notNull().default(0),
  ...utils.lifecycle(),
}, (table) => {
  return {
    slugIdx: index('idx_product_templates_slug').on(table.slug),
    statusIdx: index('idx_product_templates_status').on(table.status),
  };
});

// ── 2. TENANT TEMPLATE ASSIGNMENTS ────────────────────
export const tenantTemplates = pgTable('tenant_templates', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  templateId: uuid('template_id').notNull().references(() => productTemplates.id, { onDelete: 'cascade' }),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow(),
  appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    uniqueAssignment: uniqueIndex('idx_tenant_templates_unique').on(table.tenantId, table.templateId),
    tenantIdx: utils.tenantIdx(table),
  };
});
