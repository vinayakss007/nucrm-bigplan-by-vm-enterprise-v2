import { pgTable, uuid, text, index } from 'drizzle-orm/pg-core';
import { users } from './core';
import * as utils from './utils';

// ── Chat Sessions ─────────────────────────────────────
export const chatSessions = pgTable('chat_sessions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  visitorId: text('visitor_id').notNull(),
  visitorName: text('visitor_name'),
  visitorEmail: text('visitor_email'),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('waiting'), // 'active','waiting','closed'
  channel: text('channel').default('web'),
  convertedLeadId: uuid('converted_lead_id'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    statusIdx: index('idx_chat_sessions_status').on(table.tenantId, table.status),
    visitorIdx: index('idx_chat_sessions_visitor').on(table.visitorId),
    assignedIdx: index('idx_chat_sessions_assigned').on(table.assignedTo),
  };
});

// ── Chat Messages ─────────────────────────────────────
export const chatMessages = pgTable('chat_messages', {
  id: utils.pk(),
  sessionId: uuid('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),
  senderType: text('sender_type').notNull(), // 'visitor','agent','bot'
  senderId: text('sender_id'),
  content: text('content').notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    sessionIdx: index('idx_chat_messages_session').on(table.sessionId),
    tenantIdx: utils.tenantIdx(table),
  };
});
