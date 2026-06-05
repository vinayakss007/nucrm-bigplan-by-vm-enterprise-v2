/**
 * Territory Management Schema
 * 
 * Supports hierarchical territory structures (region > country > state > city)
 * for routing leads and contacts to the appropriate sales team members.
 */
import { pgTable, uuid, text, jsonb } from 'drizzle-orm/pg-core';
import * as utils from './utils';

export const territories = pgTable('territories', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'), // self-ref, no FK to avoid circular
  type: text('type', { enum: ['region', 'country', 'state', 'city', 'custom'] }).notNull().default('custom'),
  geoConfig: jsonb('geo_config').default({}), // {countries:[], states:[], cities:[], postalCodes:[]}
  assignedTo: uuid('assigned_to'), // primary owner shortcut
  ...utils.lifecycle(),
});

export const territoryAssignments = pgTable('territory_assignments', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  territoryId: uuid('territory_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
  ...utils.lifecycle(),
});
