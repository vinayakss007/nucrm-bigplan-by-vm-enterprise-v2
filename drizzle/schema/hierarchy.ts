/**
 * Multi-Tenant Hierarchy Schema
 * 
 * Supports parent-child relationships between tenants for franchises,
 * divisions, and multi-brand organizations.
 */
import { pgTable, uuid, text } from 'drizzle-orm/pg-core';
import * as utils from './utils';

export const tenantHierarchy = pgTable('tenant_hierarchy', {
  id: utils.pk(),
  parentTenantId: uuid('parent_tenant_id').notNull(),
  childTenantId: uuid('child_tenant_id').notNull(),
  relationship: text('relationship', { enum: ['parent', 'division', 'franchise', 'branch'] }).notNull().default('parent'),
  ...utils.lifecycle(),
});

export const hierarchyPermissions = pgTable('hierarchy_permissions', {
  id: utils.pk(),
  hierarchyId: uuid('hierarchy_id').notNull(),
  permission: text('permission', { enum: ['view_data', 'manage_users', 'share_contacts', 'aggregate_reports'] }).notNull(),
  ...utils.lifecycle(),
});
