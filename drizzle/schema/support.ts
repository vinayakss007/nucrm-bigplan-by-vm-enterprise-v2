import { pgTable, uuid, text, timestamp, jsonb, index, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as utils from './utils';
import { tenants, users } from './core';
import { contacts } from './crm';
import { webhooks } from './automation';

// ── 1. ERROR LOGS ─────────────────────────────────────
// Centralized error tracking across all services
export const errorLogs = pgTable('error_logs', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  level: text('level').notNull().default('error'),
  code: text('code'),
  message: text('message').notNull(),
  stack: text('stack'),
  context: jsonb('context').default({}),
  resolved: boolean('resolved').default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    userIdx: index('idx_error_logs_user').on(table.userId),
    levelIdx: index('idx_error_logs_level').on(table.level),
    resolvedIdx: index('idx_error_logs_resolved').on(table.resolved),
    createdIdx: index('idx_error_logs_created').on(table.createdAt),
  };
});

// ── 2. WEBHOOK QUEUE (Pending/Delayed Webhooks) ───────
// Renamed: Was conflicting with automation.webhookDeliveries
// Uses different table name to avoid database conflicts
// This tracks queued webhooks with retry logic for the main webhook system
export const webhookQueue = pgTable('webhook_queue', {
  id: utils.pk(),
  webhookId: uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  method: text('method').notNull().default('POST'),
  headers: jsonb('headers').default({}),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  attempt: integer('attempt').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    webhookIdx: index('idx_webhook_deliveries_webhook_id').on(table.webhookId),
    statusIdx: index('idx_webhook_deliveries_status').on(table.status),
    nextRetryIdx: index('idx_webhook_deliveries_next_retry').on(table.nextRetryAt).where(sql`status = 'pending'`),
  };
});

// ── 3. FAILED WEBHOOKS ────────────────────────────────
export const failedWebhooks = pgTable('failed_webhooks', {
  id: utils.pk(),
  webhookId: uuid('webhook_id').notNull(),
  tenantId: utils.tenantId(),
  url: text('url').notNull(),
  payload: jsonb('payload').notNull(),
  errorMessage: text('error_message').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    webhookIdx: index('idx_failed_webhooks_webhook').on(table.webhookId),
  };
});

// ── 4. SUPPORT TICKETS ────────────────────────────────
export const supportTickets = pgTable('support_tickets', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  
  status: text('status').notNull().default('open'), // 'open', 'in_progress', 'resolved', 'closed'
  priority: text('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  category: text('category').default('general'),
  
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  
  metadata: utils.metadata(),
  ...utils.audit(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_tickets_contact').on(table.contactId),
    assignedIdx: index('idx_tickets_assigned').on(table.assignedTo),
    statusIdx: index('idx_tickets_status').on(table.status),
    tenantStatusIdx: index('idx_tickets_tenant_status').on(table.tenantId, table.status),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

// ── 2. TICKET CONVERSATIONS (REPLIES) ─────────────────
export const ticketReplies = pgTable('ticket_replies', {
  id: utils.pk(),
  ticketId: uuid('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  
  body: text('body').notNull(),
  isInternal: boolean('is_internal').default(false),
  
  metadata: utils.metadata(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    ticketIdx: index('idx_ticket_replies_ticket').on(table.ticketId),
  };
});
