/**
 * Multi-Tenant Hierarchy Schema
 * 
 * Supports parent-child relationships between tenants for franchises,
 * divisions, and multi-brand organizations.
 */
import { pgTable, uuid, text, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';
import { tenants } from './core';

export const tenantHierarchy = pgTable('tenant_hierarchy', {
  id: utils.pk(),
  parentTenantId: uuid('parent_tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  childTenantId: uuid('child_tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  relationship: text('relationship', { enum: ['parent', 'division', 'franchise', 'branch'] }).notNull().default('parent'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    parentIdx: index('idx_tenant_hierarchy_parent').on(table.parentTenantId),
    childIdx: index('idx_tenant_hierarchy_child').on(table.childTenantId),
  };
});

export const hierarchyPermissions = pgTable('hierarchy_permissions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  hierarchyId: uuid('hierarchy_id').notNull().references(() => tenantHierarchy.id, { onDelete: 'cascade' }),
  permission: text('permission', { enum: ['view_data', 'manage_users', 'share_contacts', 'aggregate_reports'] }).notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
  };
});
