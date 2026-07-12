import { pgTable, uuid, text, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './core';
import { contacts, deals } from './crm';
import * as utils from './utils';

export const tasks = pgTable('tasks', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority').notNull().default('medium'),
  status: text('status').notNull().default('pending'),

  dueDate: timestamp('due_date', { withTimezone: true }),
  completed: boolean('completed').default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),

  metadata: utils.metadata(),

  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    tenantStatusIdx: index('idx_tasks_tenant_status').on(table.tenantId, table.status),
    assignedIdx: index('idx_tasks_assigned').on(table.assignedTo),
    createdByIdx: index('idx_tasks_created_by').on(table.createdBy),
    dueIdx: index('idx_tasks_due').on(table.dueDate),
    contactIdx: index('idx_tasks_contact').on(table.contactId),
    dealIdx: index('idx_tasks_deal').on(table.dealId),
    tenantDueActiveIdx: index('idx_tasks_tenant_due_active').on(table.tenantId, table.dueDate, table.createdAt).where(sql`deleted_at IS NULL`),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});
