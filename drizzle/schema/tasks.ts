import { sql } from 'drizzle-orm';
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { pgTable, uuid, text, timestamp, boolean, index, jsonb } from 'drizzle-orm/pg-core';
import { users } from './core';
import { contacts, deals, companies, leads } from './crm';
import { supportTickets } from './support';
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

  // A task could previously only attach to a contact or a deal, so "a task for
  // this company", "follow up on this lead" and "do this for that ticket" were
  // not representable at all. These are the relationships the product treats as
  // first-class; anything more incidental belongs in record_links.
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  ticketId: uuid('ticket_id').references(() => supportTickets.id, { onDelete: 'set null' }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),

  customFields: jsonb('custom_fields').default({}),
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
    // #2255: idx_tasks_tenant_due_active was never created live; idx_tasks_due_date
    // (tenant_id, due_date) WHERE deleted_at IS NULL AND due_date IS NOT NULL covers it.
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  
  drz2255_idx_tasks_tenant_created: index('idx_tasks_tenant_created').on(table.tenantId, table.createdAt.desc()).where(sql`(deleted_at IS NULL)`),
  drz2255_idx_tasks_due_date: index('idx_tasks_due_date').on(table.tenantId, table.dueDate).where(sql`((deleted_at IS NULL) AND (due_date IS NOT NULL))`),
  drz2255_idx_tasks_open: index('idx_tasks_open').on(table.tenantId, table.completed).where(sql`((deleted_at IS NULL) AND (completed = false))`),
  drz2255_idx_tasks_company: index('idx_tasks_company').on(table.tenantId, table.companyId),
  drz2255_idx_tasks_lead: index('idx_tasks_lead').on(table.tenantId, table.leadId),
  drz2255_idx_tasks_ticket: index('idx_tasks_ticket').on(table.tenantId, table.ticketId),
  drz2255_idx_tasks_custom_fields_g: index('idx_tasks_custom_fields_g').using('gin', table.customFields),
  drz2255_idx_tasks_company_id: index('idx_tasks_company_id').on(table.companyId),
  drz2255_idx_tasks_lead_id: index('idx_tasks_lead_id').on(table.leadId),
  drz2255_idx_tasks_ticket_id: index('idx_tasks_ticket_id').on(table.ticketId),};
});
