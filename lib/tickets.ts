/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Support-ticket status vocabulary and transition registry.
 *
 * #3407: `support_tickets.status` is a text column whose only database rule is
 * 0050's value-vocabulary CHECK, so every route re-encoded the transition rule
 * — or, more often, had none. `PATCH /api/tenant/tickets/[id]` wrote any
 * `status` from any state, so a stale "resolved" click could overwrite a
 * concurrent close/reopen and a second resolve could mint another CSAT survey.
 *
 * This registry is the one list both halves of the guard read: the request vet
 * (`canTransitionTicket`) and the SQL claim (`allowedTicketFromStatus`), the
 * same shape `OFFER_TRANSITIONS` uses in `lib/offers.ts`.
 *
 * The vocabulary is 0050's `chk_support_tickets_status`, not the older Zod
 * enum's `pending`/`awaiting_customer`, which the CHECK has never accepted —
 * those values validated and then 500'd on write. Keeping one list means the
 * API cannot drift from the column it writes.
 */
export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'waiting',
  'pending_customer',
  'escalated',
  'on_hold',
  'resolved',
  'closed',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Legal `from -> to` moves.
 *
 * The six working states move among themselves and into `resolved` or
 * `closed`; `resolved` can be closed or reopened; `closed` is terminal except
 * for an explicit reopen. Self-transitions stay legal so a repeated click, or
 * a bulk action that includes a ticket already in the target state, remains a
 * no-op instead of a 409 — the SQL claim still refuses it if another writer
 * moved the row in the gap.
 */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ['open', 'in_progress', 'waiting', 'pending_customer', 'escalated', 'on_hold', 'resolved', 'closed'],
  in_progress: ['open', 'in_progress', 'waiting', 'pending_customer', 'escalated', 'on_hold', 'resolved', 'closed'],
  waiting: ['open', 'in_progress', 'waiting', 'pending_customer', 'escalated', 'on_hold', 'resolved', 'closed'],
  pending_customer: ['open', 'in_progress', 'waiting', 'pending_customer', 'escalated', 'on_hold', 'resolved', 'closed'],
  escalated: ['open', 'in_progress', 'waiting', 'pending_customer', 'escalated', 'on_hold', 'resolved', 'closed'],
  on_hold: ['open', 'in_progress', 'waiting', 'pending_customer', 'escalated', 'on_hold', 'resolved', 'closed'],
  resolved: ['open', 'in_progress', 'resolved', 'closed'],
  closed: ['open', 'in_progress', 'closed'],
};

/**
 * The from-statuses a guarded write may claim `to` from.
 *
 * `to` reaches this from request bodies and from a `status` column something
 * else wrote, so an unknown target is not a type error at runtime. Answering
 * with the empty set keeps both halves of the guard saying "nothing may
 * transition to this" instead of throwing on an undefined index.
 */
export function allowedTicketFromStatus(to: string): readonly TicketStatus[] {
  if (!(TICKET_STATUSES as readonly string[]).includes(to)) return [];
  return TICKET_STATUSES.filter((from) => TICKET_TRANSITIONS[from].includes(to as TicketStatus));
}

/** Status transition guard. */
export function canTransitionTicket(from: string, to: string): boolean {
  return allowedTicketFromStatus(to).includes(from as TicketStatus);
}
