/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * NuCRM SDK — webhook event vocabulary and payload envelope.
 */

export type WebhookEventType =
  | 'contact.created'
  | 'contact.updated'
  | 'contact.deleted'
  | 'deal.created'
  | 'deal.updated'
  | 'deal.won'
  | 'deal.lost'
  | 'lead.created'
  | 'lead.converted'
  | 'task.created'
  | 'task.completed'
  | 'ticket.created'
  | 'ticket.resolved'
  | 'invoice.created'
  | 'invoice.paid'
  | 'company.created'
  | 'company.updated'
  | 'document.created'
  | 'document.updated'
  | 'document.deleted'
  | 'quote.created'
  | 'quote.updated'
  | 'quote.accepted'
  | 'quote.rejected'
  | 'order.created'
  | 'order.updated'
  | 'order.fulfilled'
  | 'order.cancelled'
  | 'contract.created'
  | 'contract.updated'
  | 'contract.signed'
  | 'contract.expired'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'meeting.created'
  | 'meeting.updated'
  | 'meeting.cancelled'
  | 'form.submitted'
  | 'sequence.created'
  | 'sequence.completed'
  | 'sequence.enrolled'
  | 'automation.created'
  | 'automation.triggered'
  | 'automation.completed';

export interface WebhookPayload<T = unknown> {
  event: WebhookEventType;
  timestamp: string;
  tenant_id: string;
  data: T;
  previous_data?: T;
}
