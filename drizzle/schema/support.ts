/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import {pgTable, uuid, text, timestamp, jsonb, index, boolean, integer, uniqueIndex} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as utils from './utils';
import { tenants, users } from './core';
import { contacts, companies, deals, leads } from './crm';
import { integrations } from './comm';
import { slaPolicies } from './sla';

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
  
  drz2255_idx_error_logs_resolved_by: index('idx_error_logs_resolved_by').on(table.resolvedBy),};
});

// ── 2. WEBHOOK QUEUE (Pending/Delayed Webhooks) ───────
// Renamed: Was conflicting with automation.webhookDeliveries
// Uses different table name to avoid database conflicts
// This tracks queued webhooks with retry logic for the main webhook system
// webhook_id points at integrations(id) (rows WHERE type = 'webhook') because
// all webhook CRUD in the app goes through the integrations table; the separate
// `webhooks` table is unused. See migration 0046_fix_webhook_queue.sql.
export const webhookQueue = pgTable('webhook_queue', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  webhookId: uuid('webhook_id').notNull().references(() => integrations.id, { onDelete: 'cascade' }),
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
    tenantIdx: utils.tenantIdx(table),
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
  // A ticket could only point at a contact, which made "all tickets for this
  // company" unanswerable and left no way to tie a support issue to the deal or
  // lead it puts at risk. company_id is denormalised rather than derived through
  // the contact because a ticket can be raised by an account with no named
  // contact, and because account-level reporting should not depend on a
  // nullable hop.
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  
  status: text('status').notNull().default('open'), // 'open', 'in_progress', 'resolved', 'closed'
  priority: text('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  category: text('category').default('general'),
  
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  
  // #1053: FK with SET NULL — a ticket must survive deletion of its SLA policy.
  slaPolicyId: uuid('sla_policy_id').references(() => slaPolicies.id, { onDelete: 'set null' }),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  
  /** Opaque token for unauthenticated public ticket access (email-header auth replaced). */
  portalToken: text('portal_token').notNull().unique(),

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
    portalTokenIdx: index('idx_tickets_portal_token').on(table.portalToken),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  
  drz2255_idx_support_tickets_company: index('idx_support_tickets_company').on(table.tenantId, table.companyId),
  drz2255_idx_support_tickets_deal: index('idx_support_tickets_deal').on(table.tenantId, table.dealId),
  drz2255_idx_support_tickets_lead: index('idx_support_tickets_lead').on(table.tenantId, table.leadId),
  drz2255_idx_support_tickets_company_id: index('idx_support_tickets_company_id').on(table.companyId),
  drz2255_idx_support_tickets_created_by: index('idx_support_tickets_created_by').on(table.createdBy),
  drz2255_idx_support_tickets_deal_id: index('idx_support_tickets_deal_id').on(table.dealId),
  drz2255_idx_support_tickets_lead_id: index('idx_support_tickets_lead_id').on(table.leadId),
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
  
  drz2255_idx_ticket_replies_contact_id: index('idx_ticket_replies_contact_id').on(table.contactId),
  drz2255_idx_ticket_replies_user_id: index('idx_ticket_replies_user_id').on(table.userId),};
});

// ── 6. CSAT SURVEYS ────────────────────────────────────
export const csatSurveys = pgTable('csat_surveys', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  ticketId: uuid('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),

  score: integer('score'), // 1-5 star rating, null until responded
  comment: text('comment'),

  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  token: text('token').notNull(), // unique via csat_surveys_token_key (#2255 mirror)

  metadata: utils.metadata(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    ticketIdx: index('idx_csat_ticket').on(table.ticketId),
    contactIdx: index('idx_csat_contact').on(table.contactId),
    tokenIdx: index('idx_csat_token').on(table.token),
    respondedIdx: index('idx_csat_responded').on(table.respondedAt),
  
  drz2255_csat_surveys_token_key: uniqueIndex('csat_surveys_token_key').on(table.token),};
});

// ── 7. CANNED RESPONSES ───────────────────────────────
export const cannedResponses = pgTable('canned_responses', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  category: text('category').notNull().default('general'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  shortcut: text('shortcut'), // e.g., '/thanks' — type in composer to insert

  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    shortcutIdx: index('idx_canned_shortcut').on(table.tenantId, table.shortcut),
  
  drz2255_idx_canned_responses_created_by: index('idx_canned_responses_created_by').on(table.createdBy),};
});
