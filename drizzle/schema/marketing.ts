import { uniqueIndex, pgTable, uuid, text, timestamp, jsonb, index, integer, boolean } from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import { tenants, users } from './core';
import { contacts } from './crm';
import * as utils from './utils';

// ── 1. EMAIL SEQUENCES (DRIP CAMPAIGNS) ───────────────
export const sequences = pgTable('sequences', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('draft'), // 'draft', 'active', 'paused', 'archived'
  enrollCount: integer('enroll_count').default(0),

  metadata: utils.metadata(),  
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});

export const sequenceSteps = pgTable('sequence_steps', {
  id: utils.pk(),
  sequenceId: uuid('sequence_id').notNull().references(() => sequences.id, { onDelete: 'cascade' }),
  tenantId: utils.tenantId(),

  stepNumber: integer('step_number').notNull(),
  stepType: text('step_type').notNull().default('email'), // 'email', 'delay', 'task', 'whatsapp'
  delayDays: integer('delay_days').default(0),
  delayHours: integer('delay_hours').default(0),
  delayMinutes: integer('delay_minutes').default(0),

  templateId: uuid('template_id'), // Reference to email_templates
  content: text('content'),
  subject: text('subject'),
  body: text('body'),

  isActive: boolean('is_active').notNull().default(true),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    sequenceIdx: index('idx_sequence_steps_seq').on(table.sequenceId, table.stepNumber),
    tenantIdx: utils.tenantIdx(table),
  };
});

export const sequenceStepLogs = pgTable('sequence_step_logs', {
  id: utils.pk(),
  enrollmentId: uuid('enrollment_id').notNull().references(() => sequenceEnrollments.id, { onDelete: 'cascade' }),
  stepId: uuid('step_id').references(() => sequenceSteps.id, { onDelete: 'set null' }),
  tenantId: utils.tenantId(),
  status: text('status').notNull().default('pending'), // 'pending', 'sent', 'skipped', 'failed', 'cancelled'
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    enrollmentIdx: index('idx_sequence_step_logs_enrollment').on(table.enrollmentId),
    scheduledIdx: index('idx_sequence_step_logs_scheduled').on(table.scheduledAt).where(sql`status = 'pending'`),
    tenantIdx: utils.tenantIdx(table),
  };
});

export const sequenceEnrollments = pgTable('sequence_enrollments', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  sequenceId: uuid('sequence_id').notNull().references(() => sequences.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  
  status: text('status').notNull().default('active'), // 'active', 'completed', 'paused', 'unsubscribed', 'error'
  currentStep: integer('current_step').notNull().default(1),
  nextStepAt: timestamp('next_step_at', { withTimezone: true }),
  
  enrolledBy: uuid('enrolled_by').references(() => users.id, { onDelete: 'set null' }),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    contactIdx: index('idx_seq_enroll_contact').on(table.contactId),
    sequenceIdx: index('idx_seq_enroll_seq').on(table.sequenceId),
    statusIdx: index('idx_seq_enroll_status').on(table.status),
    metadataGinIdx: utils.metadataIdx(table),
  };
});

// ── RELATIONS ───────────────────────────────────────

export const sequencesRelations = relations(sequences, ({ many }) => ({
  steps: many(sequenceSteps),
  enrollments: many(sequenceEnrollments),
}));

export const sequenceStepsRelations = relations(sequenceSteps, ({ one }) => ({
  sequence: one(sequences, {
    fields: [sequenceSteps.sequenceId],
    references: [sequences.id],
  }),
}));

export const sequenceEnrollmentsRelations = relations(sequenceEnrollments, ({ one, many }) => ({
  sequence: one(sequences, {
    fields: [sequenceEnrollments.sequenceId],
    references: [sequences.id],
  }),
  contact: one(contacts, {
    fields: [sequenceEnrollments.contactId],
    references: [contacts.id],
  }),
  logs: many(sequenceStepLogs),
}));

export const sequenceStepLogsRelations = relations(sequenceStepLogs, ({ one }) => ({
  enrollment: one(sequenceEnrollments, {
    fields: [sequenceStepLogs.enrollmentId],
    references: [sequenceEnrollments.id],
  }),
  step: one(sequenceSteps, {
    fields: [sequenceStepLogs.stepId],
    references: [sequenceSteps.id],
  }),
}));
