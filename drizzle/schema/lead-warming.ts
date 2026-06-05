/**
 * Lead Warming — Premium Module Schema
 *
 * Auto-sends personalized emails + WhatsApp messages on festivals,
 * birthdays, follow-ups, and custom events. AI analyzes replies to
 * understand intent (interested, not interested, ask later, etc.)
 *
 * This is a PREMIUM feature gated to Pro/Enterprise plans.
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './core';
import { contacts } from './crm';
import * as utils from './utils';

// ── 1. FESTIVAL / EVENT CALENDAR ──────────────────────────────────────────
// Global + per-tenant event definitions (Diwali, Christmas, New Year, Holi, etc.)
export const leadWarmingEvents = pgTable('lead_warming_events', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  // null tenantId = global (system-provided) event

  name: text('name').notNull(),                     // "Diwali", "Christmas", "New Year"
  description: text('description'),
  eventType: text('event_type').notNull().default('festival'),
  // 'festival' | 'holiday' | 'season' | 'custom' | 'birthday' | 'anniversary'

  // Recurrence
  recurrence: text('recurrence').notNull().default('yearly'),
  // 'yearly' | 'monthly' | 'once' | 'contact_specific' (birthday/anniversary)

  // Fixed date events (month + day for yearly recurring)
  eventMonth: integer('event_month'),               // 1-12
  eventDay: integer('event_day'),                   // 1-31
  eventDate: timestamp('event_date', { withTimezone: true }), // for one-time events

  // Sending window
  sendDaysBefore: integer('send_days_before').default(0),  // 0 = on the day, 1 = day before
  sendHour: integer('send_hour').default(9),               // Hour to send (0-23)

  // Channel preferences
  channels: jsonb('channels').default(['email', 'whatsapp']),
  // ['email'] | ['whatsapp'] | ['email', 'whatsapp']

  // Default templates (can be overridden per campaign)
  defaultEmailSubject: text('default_email_subject'),
  defaultEmailBody: text('default_email_body'),
  defaultWhatsappTemplate: text('default_whatsapp_template'),

  // AI message generation prompt hint
  aiPromptHint: text('ai_prompt_hint'),
  // e.g. "Generate a warm Diwali greeting for a business contact"

  isActive: boolean('is_active').default(true),
  isSystem: boolean('is_system').default(false),    // System events can't be deleted
  region: text('region'),                           // 'IN', 'US', 'global', etc.
  tags: jsonb('tags').default([]),

  ...utils.lifecycle(),
}, (table) => ({
  tenantIdx: index('idx_lead_warming_events_tenant').on(table.tenantId),
  eventTypeIdx: index('idx_lead_warming_events_type').on(table.eventType),
  monthDayIdx: index('idx_lead_warming_events_month_day').on(table.eventMonth, table.eventDay),
  activeIdx: index('idx_lead_warming_events_active').on(table.isActive).where(sql`is_active = true`),
}));

// ── 2. LEAD WARMING CAMPAIGNS ─────────────────────────────────────────────
// Tenant-level campaign config: which contacts, which events, what channels
export const leadWarmingCampaigns = pgTable('lead_warming_campaigns', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  // 'active' | 'paused' | 'draft' | 'archived'

  // Target audience
  targetFilter: jsonb('target_filter').default({}),
  // { leadStatus: ['warm', 'hot'], tags: ['vip'], lifecycleStage: ['lead', 'opportunity'] }

  // Which events to trigger on
  eventIds: jsonb('event_ids').default([]),          // UUIDs of lead_warming_events
  includeBirthdays: boolean('include_birthdays').default(true),
  includeAnniversaries: boolean('include_anniversaries').default(false),

  // Channel config
  enableEmail: boolean('enable_email').default(true),
  enableWhatsapp: boolean('enable_whatsapp').default(true),
  enableSms: boolean('enable_sms').default(false),

  // AI settings
  aiGenerateMessages: boolean('ai_generate_messages').default(true),
  aiTone: text('ai_tone').default('warm_professional'),
  // 'warm_professional' | 'casual_friendly' | 'formal' | 'festive'
  aiLanguage: text('ai_language').default('en'),
  // 'en' | 'hi' | 'es' | 'fr' | auto-detect from contact

  // Reply handling
  aiAnalyzeReplies: boolean('ai_analyze_replies').default(true),
  autoRespondToPositive: boolean('auto_respond_to_positive').default(false),
  notifyOnPositiveIntent: boolean('notify_on_positive_intent').default(true),

  // Limits
  maxMessagesPerContactPerMonth: integer('max_messages_per_contact_per_month').default(4),
  cooldownDays: integer('cooldown_days').default(7), // Min days between messages to same contact

  // Stats
  totalSent: integer('total_sent').default(0),
  totalReplies: integer('total_replies').default(0),
  totalPositiveIntent: integer('total_positive_intent').default(0),

  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  ...utils.lifecycle(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  statusIdx: index('idx_lead_warming_campaigns_status').on(table.tenantId, table.status),
  activeIdx: index('idx_lead_warming_campaigns_active').on(table.status).where(sql`status = 'active'`),
}));

// ── 3. SENT MESSAGES LOG ──────────────────────────────────────────────────
// Every message sent by the warming system
export const leadWarmingMessages = pgTable('lead_warming_messages', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  campaignId: uuid('campaign_id').notNull().references(() => leadWarmingCampaigns.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').references(() => leadWarmingEvents.id, { onDelete: 'set null' }),

  // Message details
  channel: text('channel').notNull(),               // 'email' | 'whatsapp' | 'sms'
  subject: text('subject'),                         // Email subject
  body: text('body').notNull(),                     // Message content
  templateUsed: text('template_used'),              // WhatsApp template name if used

  // AI generation metadata
  aiGenerated: boolean('ai_generated').default(false),
  aiModel: text('ai_model'),
  aiPromptUsed: text('ai_prompt_used'),

  // Delivery status
  status: text('status').notNull().default('pending'),
  // 'pending' | 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced'
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  errorMessage: text('error_message'),

  // Engagement
  openedAt: timestamp('opened_at', { withTimezone: true }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }),

  // Context
  eventName: text('event_name'),                    // Denormalized for quick display
  personalizedFor: text('personalized_for'),        // "Birthday", "Diwali", etc.

  metadata: jsonb('metadata').default({}),
  ...utils.lifecycle(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  campaignIdx: index('idx_lead_warming_msg_campaign').on(table.campaignId, table.createdAt),
  contactIdx: index('idx_lead_warming_msg_contact').on(table.contactId, table.createdAt),
  statusIdx: index('idx_lead_warming_msg_status').on(table.status, table.sentAt),
  channelIdx: index('idx_lead_warming_msg_channel').on(table.tenantId, table.channel, table.sentAt),
}));

// ── 4. REPLY ANALYSIS (AI-POWERED) ───────────────────────────────────────
// When a lead replies, AI classifies intent + sentiment
export const leadWarmingReplies = pgTable('lead_warming_replies', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  messageId: uuid('message_id').notNull().references(() => leadWarmingMessages.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').references(() => leadWarmingCampaigns.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),

  // Raw reply
  channel: text('channel').notNull(),               // 'email' | 'whatsapp'
  replyContent: text('reply_content').notNull(),    // The actual reply text
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow(),

  // ── AI Analysis ──
  aiAnalyzed: boolean('ai_analyzed').default(false),
  aiAnalyzedAt: timestamp('ai_analyzed_at', { withTimezone: true }),

  // Intent classification
  intent: text('intent'),
  // 'interested' | 'not_interested' | 'ask_later' | 'question' |
  // 'complaint' | 'out_of_office' | 'unsubscribe' | 'positive_social' | 'unknown'

  intentConfidence: integer('intent_confidence'),   // 0-100

  // Sentiment
  sentiment: text('sentiment'),                     // 'positive' | 'neutral' | 'negative'
  sentimentScore: integer('sentiment_score'),       // -100 to +100

  // AI-extracted data
  aiSummary: text('ai_summary'),                    // One-line summary of reply
  aiSuggestedAction: text('ai_suggested_action'),   // "Schedule a call", "Send pricing", etc.
  aiExtractedEntities: jsonb('ai_extracted_entities').default({}),
  // { budget: "$5000", timeline: "next month", product_interest: "CRM Pro" }

  // Follow-up
  requiresFollowUp: boolean('requires_follow_up').default(false),
  followUpCreated: boolean('follow_up_created').default(false),
  followUpTaskId: uuid('follow_up_task_id'),

  // Notification
  ownerNotified: boolean('owner_notified').default(false),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),

  metadata: jsonb('metadata').default({}),
  ...utils.lifecycle(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  messageIdx: index('idx_lead_warming_replies_message').on(table.messageId),
  contactIdx: index('idx_lead_warming_replies_contact').on(table.contactId),
  intentIdx: index('idx_lead_warming_replies_intent').on(table.tenantId, table.intent),
  unanalyzedIdx: index('idx_lead_warming_replies_unanalyzed').on(table.aiAnalyzed).where(sql`ai_analyzed = false`),
  positiveIdx: index('idx_lead_warming_replies_positive').on(table.tenantId, table.intent).where(sql`intent = 'interested'`),
}));

// ── 5. CONTACT WARMING SCHEDULE ───────────────────────────────────────────
// Per-contact schedule tracking (prevent over-messaging)
export const leadWarmingSchedule = pgTable('lead_warming_schedule', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').notNull().references(() => leadWarmingCampaigns.id, { onDelete: 'cascade' }),

  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  nextEligibleAt: timestamp('next_eligible_at', { withTimezone: true }),
  messagesThisMonth: integer('messages_this_month').default(0),
  totalMessages: integer('total_messages').default(0),
  totalReplies: integer('total_replies').default(0),

  // Contact preferences (learned from replies)
  preferredChannel: text('preferred_channel'),       // 'email' | 'whatsapp' | null
  optedOut: boolean('opted_out').default(false),
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
  optOutReason: text('opt_out_reason'),

  ...utils.lifecycle(),
}, (table) => ({
  uniqueContactCampaign: uniqueIndex('idx_lead_warming_sched_unique').on(table.contactId, table.campaignId),
  tenantIdx: utils.tenantIdx(table),
  eligibleIdx: index('idx_lead_warming_sched_eligible').on(table.nextEligibleAt).where(sql`opted_out = false`),
}));
