import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { contacts } from './crm';
import * as utils from './utils';

// ── Email Opens ───────────────────────────────────────
export const emailOpens = pgTable('email_opens', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id'),
  emailId: uuid('email_id'),
  openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_email_opens_contact').on(table.contactId),
    campaignIdx: index('idx_email_opens_campaign').on(table.campaignId),
  };
});

// ── Email Clicks ──────────────────────────────────────
export const emailClicks = pgTable('email_clicks', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id'),
  emailId: uuid('email_id'),
  linkUrl: text('link_url').notNull(),
  clickedAt: timestamp('clicked_at', { withTimezone: true }).defaultNow(),
  ipAddress: text('ip_address'),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_email_clicks_contact').on(table.contactId),
    campaignIdx: index('idx_email_clicks_campaign').on(table.campaignId),
  };
});
