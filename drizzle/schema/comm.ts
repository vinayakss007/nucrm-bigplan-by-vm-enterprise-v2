import { sql } from 'drizzle-orm';
import { uniqueIndex, pgTable, uuid, text, timestamp, integer, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { users, apiKeys } from './core';
import { contacts, deals, companies } from './crm';
import { webhooks } from './automation';
import { sequenceEnrollments } from './marketing';
import * as utils from './utils';

// ── 1. WHATSAPP MODULE ────────────────────────────────
export const whatsappConversations = pgTable('whatsapp_conversations', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  whatsappFrom: text('whatsapp_from').notNull(),
  whatsappTo: text('whatsapp_to').notNull(),
  status: text('status').notNull().default('active'),
  aiEnabled: boolean('ai_enabled').default(false),
  aiLastResponse: text('ai_last_response'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow(),
  messageCount: integer('message_count').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_whatsapp_conv_contact').on(table.contactId),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

export const whatsappMessages = pgTable('whatsapp_messages', {
  id: utils.pk(),
  conversationId: uuid('conversation_id').notNull().references(() => whatsappConversations.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  direction: text('direction').notNull(),
  contentType: text('content_type').notNull().default('text'),
  content: text('content').notNull(),
  externalId: text('external_id'),
  status: text('status').notNull().default('sent'),
  aiGenerated: boolean('ai_generated').default(false),
  aiModelUsed: text('ai_model_used'),
  delivered: boolean('delivered').default(false),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (table) => {
  return {
    convIdx: index('idx_whatsapp_msg_conv').on(table.conversationId),
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 2. VOICE & CALLS ──────────────────────────────────
export const voiceCalls = pgTable('voice_calls', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  callSid: text('call_sid'),
  direction: text('direction').notNull(),
  status: text('status').notNull(),
  durationSeconds: integer('duration_seconds').default(0),
  recordingUrl: text('recording_url'),
  transcript: text('transcript'),
  aiSummary: text('ai_summary'),
  aiSentiment: text('ai_sentiment'),
  aiActionItems: jsonb('ai_action_items').default([]),
  costCents: integer('cost_cents').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const callLogs = pgTable('call_logs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  direction: text('direction').notNull().default('outbound'),
  duration: integer('duration').default(0),
  notes: text('notes'),
  phoneNumber: text('phone_number'),
  recordedUrl: text('recorded_url'),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 3. EMAIL MARKETING & AI DRAFTS ────────────────────
export const emailTemplates = pgTable('email_templates', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  bodyHtml: text('body_html').notNull(),
  bodyText: text('body_text'),
  category: text('category'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

// Renamed: Was conflicting with automation.aiEmailDrafts
// This table tracks AI-generated email drafts for communications
export const emailDrafts = pgTable('comm_email_drafts', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  dealId: uuid('deal_id').references(() => deals.id),
  purpose: text('purpose').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  tone: text('tone').default('professional'),
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

export const emailTracking = pgTable('email_tracking', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  recipient: text('recipient'),
  messageId: text('message_id'),
  subject: text('subject'),
  sequenceEnrollmentId: uuid('sequence_enrollment_id').references(() => sequenceEnrollments.id, { onDelete: 'set null' }),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }),
  openCount: integer('open_count').default(0),
  clickCount: integer('click_count').default(0),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── 4. INTEGRATIONS ───────────────────────────────────
export const integrations = pgTable('integrations', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(), // 'google', 'outlook', 'zoom', 'slack'
  name: text('name').notNull(),
  config: jsonb('config').default({}),
  isActive: boolean('is_active').default(true),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantTypeIdx: index('idx_integrations_tenant_type').on(table.tenantId, table.type),
    configGinIdx: index('idx_integrations_metadata_g').on(table.config), // Using config for integrations as it is JSONB
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 4. EMAIL LOG ──────────────────────────────────────
export const emailLog = pgTable('email_log', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id),
  fromEmail: text('from_email').notNull(),
  toEmail: text('to_email').notNull(),
  subject: text('subject'),
  body: text('body'),
  templateId: uuid('template_id'),
  status: text('status').notNull().default('pending'), // 'pending', 'sent', 'failed', 'bounced'
  provider: text('provider'), // 'resend', 'smtp', 'sendgrid'
  providerMessageId: text('provider_message_id'),
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_email_log_contact').on(table.contactId, table.createdAt),
    statusIdx: index('idx_email_log_status').on(table.status, table.createdAt),
  };
});

// ── 4. EMAIL VERIFICATIONS ────────────────────────────
export const emailVerifications = pgTable('email_verifications', {
  id: utils.pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  ...utils.lifecycle(),
});

// ── 5. EMAIL WARMUP CONFIGS ───────────────────────────
export const emailWarmupConfigs = pgTable('email_warmup_configs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  isActive: boolean('is_active').default(false),
  dailyLimitStart: integer('daily_limit_start').default(5),
  dailyLimitCurrent: integer('daily_limit_current').default(5),
  dailyLimitMax: integer('daily_limit_max').default(50),
  rampUpDays: integer('ramp_up_days').default(21),
  fromEmail: text('from_email').notNull(),
  fromName: text('from_name').default(''),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  lastWarmupAt: timestamp('last_warmup_at', { withTimezone: true }),
  totalSent: integer('total_sent').default(0),
  totalReplied: integer('total_replied').default(0),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    uniqueEmailIdx: uniqueIndex('idx_email_warmup_unique').on(table.tenantId, table.fromEmail),
  };
});

// ── 6. EMAIL WARMUP POOL ─────────────────────────────
export const emailWarmupPool = pgTable('email_warmup_pool', {
  id: utils.pk(),
  configId: uuid('config_id').notNull().references(() => emailWarmupConfigs.id, { onDelete: 'cascade' }),
  participantEmail: text('participant_email').notNull(),
  participantName: text('participant_name').default(''),
  status: text('status').default('active'),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  lastRepliedAt: timestamp('last_replied_at', { withTimezone: true }),
  sentCount: integer('sent_count').default(0),
  replyCount: integer('reply_count').default(0),
  ...utils.lifecycle(),
}, (table) => {
  return {
    configIdx: index('idx_email_warmup_pool_config').on(table.configId, table.status),
  };
});

export const emailWarmupLogs = pgTable('email_warmup_logs', {
  id: utils.pk(),
  configId: uuid('config_id').notNull().references(() => emailWarmupConfigs.id, { onDelete: 'cascade' }),
  participantId: uuid('participant_id').references(() => emailWarmupPool.id, { onDelete: 'set null' }),
  direction: text('direction').notNull().default('outbound'),
  subject: text('subject'),
  body: text('body'),
  status: text('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  repliedAt: timestamp('replied_at', { withTimezone: true }),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    configIdx: index('idx_email_warmup_logs_config').on(table.configId, table.createdAt),
  };
});

// ── 7. WEBHOOK INBOUND LOGS ────────────────────────--
export const webhookInboundLogs = pgTable('webhook_inbound_logs', {
  id: utils.pk(),
  webhookId: uuid('webhook_id').references(() => webhooks.id),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
  tenantId: utils.tenantId(),
  action: text('action'),
  entity: text('entity'),
  status: text('status'),
  statusCode: integer('status_code'),
  payload: jsonb('payload'),
  headers: jsonb('headers').default({}),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  recordId: uuid('record_id'),
  payloadSize: integer('payload_size'),
  processed: boolean('processed').default(false),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    webhookIdx: index('idx_webhook_inbound_logs_webhook').on(table.webhookId),
    apiKeyIdx: index('idx_webhook_inbound_logs_api_key').on(table.apiKeyId),
    processedIdx: index('idx_webhook_inbound_logs_processed').on(table.processed).where(sql`processed = false`),
    tenantIdx: utils.tenantIdx(table),
  };
});

// ── 8. WHATSAPP TEMPLATES ─────────────────────────────
export const whatsappTemplates = pgTable('whatsapp_templates', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  language: text('language').default('en'),
  category: text('category'),
  status: text('status'),
  content: text('content'),
  components: jsonb('components').default([]),
  variables: jsonb('variables').default([]),
  metaData: jsonb('meta_data').default({}),
  isActive: boolean('is_active').default(true),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    uniqueNameLang: uniqueIndex('idx_whatsapp_templates_unique').on(table.tenantId, table.name, table.language),
  };
});
