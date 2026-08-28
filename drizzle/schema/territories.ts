/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Territory Management Schema
 * 
 * Supports hierarchical territory structures (region > country > state > city)
 * for routing leads and contacts to the appropriate sales team members.
 */
import { pgTable, uuid, text, jsonb, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';
import { users } from './core';

export const territories = pgTable('territories', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'), // self-ref, no FK to avoid circular
  type: text('type', { enum: ['region', 'country', 'state', 'city', 'custom'] }).notNull().default('custom'),
  geoConfig: jsonb('geo_config').default({}), // {countries:[], states:[], cities:[], postalCodes:[]}
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }), // primary owner shortcut
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    parentIdx: index('idx_territories_parent').on(table.parentId),
  };
});

export const territoryAssignments = pgTable('territory_assignments', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  territoryId: uuid('territory_id').notNull().references(() => territories.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    // #1054: index the FK columns used for joins/lookups.
    territoryIdx: index('idx_territory_assignments_territory').on(table.territoryId),
    userIdx: index('idx_territory_assignments_user').on(table.userId),
  };
});
