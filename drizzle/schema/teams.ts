/**
 * Teams Schema
 *
 * A team is a named group of users inside a tenant — "Sales", "Marketing",
 * "Support (SLA)" — with an optional manager. Teams are the missing spine for
 * routing work and reporting: leads/contacts can belong to a team, assignment
 * rules can target a team, and reports can group by team.
 *
 * See docs/workflow-gaps.md WF-04. Before this existed, `tenant_members` had a
 * single flat `role_slug` and `contacts.lead_access` defaulted to 'team' while
 * referencing a "team" that had no backing table.
 */
import { pgTable, uuid, text, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './core';
import * as utils from './utils';

export const teams = pgTable('teams', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  // The person accountable for the team. SET NULL so removing a user does not
  // delete the team they happened to manage.
  managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    managerIdx: index('idx_teams_manager').on(table.managerId),
    // Team names are unique per tenant (case-sensitive at the DB layer; the API
    // normalises before insert).
    tenantNameIdx: uniqueIndex('idx_teams_tenant_name').on(table.tenantId, table.name),
  };
});

export const teamMembers = pgTable('team_members', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // 'manager' may reassign within the team; 'member' works its own queue.
  role: text('role', { enum: ['manager', 'member'] }).notNull().default('member'),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    teamIdx: index('idx_team_members_team').on(table.teamId),
    userIdx: index('idx_team_members_user').on(table.userId),
    // A user appears at most once per team.
    teamUserIdx: uniqueIndex('idx_team_members_team_user').on(table.teamId, table.userId),
  };
});
