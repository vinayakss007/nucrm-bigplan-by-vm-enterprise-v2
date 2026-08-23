/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Webhook Event Catalog
 *
 * Central registry of all webhook events the NuCRM system emits.
 * Provides:
 * - Event names and descriptions (for documentation)
 * - Payload type definitions (for SDK generation)
 * - Category grouping (for subscription UI filtering)
 * - Schema validation for emitted events
 *
 * Usage:
 * ```ts
 * import { WebhookEvent, getEventInfo, listEventsByCategory } from '@/lib/webhooks/event-catalog';
 *
 * // Emit a webhook:
 * emitWebhook(WebhookEvent.CONTACT_CREATED, { contact: createdContact });
 *
 * // List available events for subscription UI:
 * const events = listEventsByCategory('contacts');
 * ```
 */

/**
 * All webhook event types. Format: entity.action
 */
export const WebhookEvent = {
  // ── Contacts ──
  CONTACT_CREATED: 'contact.created',
  CONTACT_UPDATED: 'contact.updated',
  CONTACT_DELETED: 'contact.deleted',
  CONTACT_MERGED: 'contact.merged',

  // ── Companies ──
  COMPANY_CREATED: 'company.created',
  COMPANY_UPDATED: 'company.updated',
  COMPANY_DELETED: 'company.deleted',

  // ── Deals ──
  DEAL_CREATED: 'deal.created',
  DEAL_UPDATED: 'deal.updated',
  DEAL_DELETED: 'deal.deleted',
  DEAL_STAGE_CHANGED: 'deal.stage_changed',
  DEAL_WON: 'deal.won',
  DEAL_LOST: 'deal.lost',

  // ── Leads ──
  LEAD_CREATED: 'lead.created',
  LEAD_UPDATED: 'lead.updated',
  LEAD_CONVERTED: 'lead.converted',
  LEAD_ASSIGNED: 'lead.assigned',

  // ── Tasks ──
  TASK_CREATED: 'task.created',
  TASK_COMPLETED: 'task.completed',
  TASK_OVERDUE: 'task.overdue',

  // ── Activities ──
  ACTIVITY_LOGGED: 'activity.logged',
  NOTE_CREATED: 'note.created',
  CALL_COMPLETED: 'call.completed',
  EMAIL_SENT: 'email.sent',
  EMAIL_OPENED: 'email.opened',

  // ── Tickets ──
  TICKET_CREATED: 'ticket.created',
  TICKET_UPDATED: 'ticket.updated',
  TICKET_RESOLVED: 'ticket.resolved',
  TICKET_ESCALATED: 'ticket.escalated',

  // ── Invoices ──
  INVOICE_CREATED: 'invoice.created',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_OVERDUE: 'invoice.overdue',
  PAYMENT_RECEIVED: 'payment.received',

  // ── Users ──
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',

  // ── System ──
  WEBHOOK_TEST: 'webhook.test',
  AUTOMATION_TRIGGERED: 'automation.triggered',
  EXPORT_COMPLETED: 'export.completed',
  IMPORT_COMPLETED: 'import.completed',
} as const;

export type WebhookEventType = typeof WebhookEvent[keyof typeof WebhookEvent];

export type EventCategory =
  | 'contacts'
  | 'companies'
  | 'deals'
  | 'leads'
  | 'tasks'
  | 'activities'
  | 'tickets'
  | 'invoices'
  | 'users'
  | 'system';

export interface EventDefinition {
  /** The event identifier (e.g., 'contact.created') */
  event: WebhookEventType;
  /** Human-readable description */
  description: string;
  /** Category for grouping */
  category: EventCategory;
  /** Example payload keys */
  payloadKeys: string[];
  /** Whether this event is enabled by default for new subscriptions */
  defaultEnabled: boolean;
}

/**
 * Complete event catalog with metadata.
 */
const EVENT_DEFINITIONS: EventDefinition[] = [
  // Contacts
  { event: WebhookEvent.CONTACT_CREATED, description: 'A new contact was created', category: 'contacts', payloadKeys: ['contact'], defaultEnabled: true },
  { event: WebhookEvent.CONTACT_UPDATED, description: 'A contact was updated', category: 'contacts', payloadKeys: ['contact', 'changes'], defaultEnabled: true },
  { event: WebhookEvent.CONTACT_DELETED, description: 'A contact was deleted', category: 'contacts', payloadKeys: ['contactId'], defaultEnabled: true },
  { event: WebhookEvent.CONTACT_MERGED, description: 'Two contacts were merged', category: 'contacts', payloadKeys: ['primaryId', 'mergedId'], defaultEnabled: false },

  // Companies
  { event: WebhookEvent.COMPANY_CREATED, description: 'A new company was created', category: 'companies', payloadKeys: ['company'], defaultEnabled: true },
  { event: WebhookEvent.COMPANY_UPDATED, description: 'A company was updated', category: 'companies', payloadKeys: ['company', 'changes'], defaultEnabled: true },
  { event: WebhookEvent.COMPANY_DELETED, description: 'A company was deleted', category: 'companies', payloadKeys: ['companyId'], defaultEnabled: false },

  // Deals
  { event: WebhookEvent.DEAL_CREATED, description: 'A new deal was created', category: 'deals', payloadKeys: ['deal'], defaultEnabled: true },
  { event: WebhookEvent.DEAL_UPDATED, description: 'A deal was updated', category: 'deals', payloadKeys: ['deal', 'changes'], defaultEnabled: true },
  { event: WebhookEvent.DEAL_DELETED, description: 'A deal was deleted', category: 'deals', payloadKeys: ['dealId'], defaultEnabled: false },
  { event: WebhookEvent.DEAL_STAGE_CHANGED, description: 'A deal moved to a new stage', category: 'deals', payloadKeys: ['deal', 'previousStage', 'newStage'], defaultEnabled: true },
  { event: WebhookEvent.DEAL_WON, description: 'A deal was marked as won', category: 'deals', payloadKeys: ['deal', 'amount'], defaultEnabled: true },
  { event: WebhookEvent.DEAL_LOST, description: 'A deal was marked as lost', category: 'deals', payloadKeys: ['deal', 'reason'], defaultEnabled: true },

  // Leads
  { event: WebhookEvent.LEAD_CREATED, description: 'A new lead was created', category: 'leads', payloadKeys: ['lead', 'source'], defaultEnabled: true },
  { event: WebhookEvent.LEAD_UPDATED, description: 'A lead was updated', category: 'leads', payloadKeys: ['lead', 'changes'], defaultEnabled: false },
  { event: WebhookEvent.LEAD_CONVERTED, description: 'A lead was converted to a contact/deal', category: 'leads', payloadKeys: ['lead', 'contactId', 'dealId'], defaultEnabled: true },
  { event: WebhookEvent.LEAD_ASSIGNED, description: 'A lead was assigned to a user', category: 'leads', payloadKeys: ['lead', 'assignedTo'], defaultEnabled: false },

  // Tasks
  { event: WebhookEvent.TASK_CREATED, description: 'A new task was created', category: 'tasks', payloadKeys: ['task'], defaultEnabled: false },
  { event: WebhookEvent.TASK_COMPLETED, description: 'A task was completed', category: 'tasks', payloadKeys: ['task', 'completedBy'], defaultEnabled: false },
  { event: WebhookEvent.TASK_OVERDUE, description: 'A task became overdue', category: 'tasks', payloadKeys: ['task', 'overdueBy'], defaultEnabled: false },

  // Activities
  { event: WebhookEvent.ACTIVITY_LOGGED, description: 'An activity was logged', category: 'activities', payloadKeys: ['activity'], defaultEnabled: false },
  { event: WebhookEvent.NOTE_CREATED, description: 'A note was added', category: 'activities', payloadKeys: ['note', 'entityType', 'entityId'], defaultEnabled: false },
  { event: WebhookEvent.CALL_COMPLETED, description: 'A call was completed', category: 'activities', payloadKeys: ['call', 'duration'], defaultEnabled: false },
  { event: WebhookEvent.EMAIL_SENT, description: 'An email was sent', category: 'activities', payloadKeys: ['email', 'to'], defaultEnabled: false },
  { event: WebhookEvent.EMAIL_OPENED, description: 'An email was opened by recipient', category: 'activities', payloadKeys: ['email', 'openedAt'], defaultEnabled: false },

  // Tickets
  { event: WebhookEvent.TICKET_CREATED, description: 'A support ticket was created', category: 'tickets', payloadKeys: ['ticket'], defaultEnabled: true },
  { event: WebhookEvent.TICKET_UPDATED, description: 'A ticket was updated', category: 'tickets', payloadKeys: ['ticket', 'changes'], defaultEnabled: false },
  { event: WebhookEvent.TICKET_RESOLVED, description: 'A ticket was resolved', category: 'tickets', payloadKeys: ['ticket', 'resolution'], defaultEnabled: true },
  { event: WebhookEvent.TICKET_ESCALATED, description: 'A ticket was escalated', category: 'tickets', payloadKeys: ['ticket', 'escalatedTo'], defaultEnabled: true },

  // Invoices
  { event: WebhookEvent.INVOICE_CREATED, description: 'An invoice was created', category: 'invoices', payloadKeys: ['invoice'], defaultEnabled: true },
  { event: WebhookEvent.INVOICE_PAID, description: 'An invoice was paid', category: 'invoices', payloadKeys: ['invoice', 'payment'], defaultEnabled: true },
  { event: WebhookEvent.INVOICE_OVERDUE, description: 'An invoice became overdue', category: 'invoices', payloadKeys: ['invoice', 'daysOverdue'], defaultEnabled: true },
  { event: WebhookEvent.PAYMENT_RECEIVED, description: 'A payment was received', category: 'invoices', payloadKeys: ['payment', 'invoiceId'], defaultEnabled: true },

  // Users
  { event: WebhookEvent.USER_CREATED, description: 'A new user was added', category: 'users', payloadKeys: ['user'], defaultEnabled: false },
  { event: WebhookEvent.USER_UPDATED, description: 'A user was updated', category: 'users', payloadKeys: ['user', 'changes'], defaultEnabled: false },
  { event: WebhookEvent.USER_DEACTIVATED, description: 'A user was deactivated', category: 'users', payloadKeys: ['userId'], defaultEnabled: false },

  // System
  { event: WebhookEvent.WEBHOOK_TEST, description: 'Test webhook ping', category: 'system', payloadKeys: ['message', 'timestamp'], defaultEnabled: false },
  { event: WebhookEvent.AUTOMATION_TRIGGERED, description: 'An automation rule was triggered', category: 'system', payloadKeys: ['automation', 'trigger'], defaultEnabled: false },
  { event: WebhookEvent.EXPORT_COMPLETED, description: 'A data export finished', category: 'system', payloadKeys: ['exportId', 'format', 'rowCount'], defaultEnabled: false },
  { event: WebhookEvent.IMPORT_COMPLETED, description: 'A data import finished', category: 'system', payloadKeys: ['importId', 'rowCount', 'errors'], defaultEnabled: false },
];

/**
 * Get metadata for a specific event.
 */
export function getEventInfo(event: string): EventDefinition | null {
  return EVENT_DEFINITIONS.find((e) => e.event === event) ?? null;
}

/**
 * List all events in a category.
 */
export function listEventsByCategory(category: EventCategory): EventDefinition[] {
  return EVENT_DEFINITIONS.filter((e) => e.category === category);
}

/**
 * Get all available categories.
 */
export function getCategories(): EventCategory[] {
  const cats = new Set(EVENT_DEFINITIONS.map((e) => e.category));
  return Array.from(cats) as EventCategory[];
}

/**
 * Get all event definitions (for documentation).
 */
export function getAllEvents(): EventDefinition[] {
  return [...EVENT_DEFINITIONS];
}

/**
 * Get events that are enabled by default (for new webhook subscriptions).
 */
export function getDefaultEnabledEvents(): WebhookEventType[] {
  return EVENT_DEFINITIONS.filter((e) => e.defaultEnabled).map((e) => e.event);
}

/**
 * Check if an event name is valid.
 */
export function isValidEvent(event: string): event is WebhookEventType {
  return EVENT_DEFINITIONS.some((e) => e.event === event);
}
