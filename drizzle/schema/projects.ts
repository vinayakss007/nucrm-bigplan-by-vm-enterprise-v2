import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex, date } from 'drizzle-orm/pg-core';
import { users } from './core';
import { tasks } from './infra';
import * as utils from './utils';

// ── 1. PROJECTS ───────────────────────────────────────
export const projects = pgTable('projects', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  startDate: date('start_date'),
  endDate: date('end_date'),

  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),

  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    statusIdx: index('idx_projects_status').on(table.tenantId, table.status),
    ownerIdx: index('idx_projects_owner').on(table.ownerId),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 2. MILESTONES ─────────────────────────────────────
export const milestones = pgTable('milestones', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  dueDate: date('due_date'),
  completed: boolean('completed').default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    projectIdx: index('idx_milestones_project').on(table.projectId),
  };
});

// ── 3. PROJECT TASKS (Linking table) ──────────────────
export const projectTasks = pgTable('project_tasks', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),

  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => {
  return {
    uniqueProjectTask: uniqueIndex('idx_project_tasks_unique').on(table.projectId, table.taskId),
    tenantIdx: utils.tenantIdx(table),
  };
});
