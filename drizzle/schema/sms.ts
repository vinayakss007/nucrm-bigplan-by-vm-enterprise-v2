import { pgTable, uuid, text, jsonb, index } from 'drizzle-orm/pg-core';
import { contacts } from './crm';
import * as utils from './utils';

// ── SMS Messages ──────────────────────────────────────
export const smsMessages = pgTable('sms_messages', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  direction: text('direction').notNull(), // 'inbound' | 'outbound'
  to: text('to').notNull(),
  from: text('from').notNull(),
  body: text('body').notNull(),
  templateId: uuid('template_id'),
  status: text('status').notNull().default('queued'), // 'queued','sent','delivered','failed'
  twilioSid: text('twilio_sid'),
  errorCode: text('error_code'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_sms_messages_contact').on(table.contactId),
    statusIdx: index('idx_sms_messages_status').on(table.tenantId, table.status),
    twilioSidIdx: index('idx_sms_messages_twilio_sid').on(table.twilioSid),
  };
});

// ── SMS Templates ─────────────────────────────────────
export const smsTemplates = pgTable('sms_templates', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  body: text('body').notNull(),
  variables: jsonb('variables').default([]),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});
