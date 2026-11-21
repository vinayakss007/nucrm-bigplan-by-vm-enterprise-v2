/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the per-table transition registry.
 *
 * Each entry is the "allowed from-states, given a target" function the entity
 * already owns (offers in `lib/offers.ts`, tickets in `lib/tickets.ts`). The
 * registry does not restate the rules: a second copy is exactly how #658 and
 * #3156 drifted. Routes call `allowedFromStatus` for the request-side vet and
 * hand the same list to `transitionStatus` for the SQL claim, so the two cannot
 * disagree.
 *
 * The database CHECK is generated from this registry in the migration that
 * converts each table; a route cannot bypass it by writing status directly.
 */
import { allowedFromStatus as offerFromStatus } from '@/lib/offers';
import { allowedTicketFromStatus as ticketFromStatus } from '@/lib/tickets';
import { allowedTemplateFromStatus } from '@/lib/templates/transitions';
import { allowedMemberFromStatus } from '@/lib/membership';

export const TRANSITIONS = {
  quotes: offerFromStatus,
  supportTickets: ticketFromStatus,
  productTemplates: allowedTemplateFromStatus,
  tenantMembers: allowedMemberFromStatus,
} as const;

export type TransitionTable = keyof typeof TRANSITIONS;

/** Unknown tables/targets have no legal transitions — fail closed. */
export function allowedFromStatus(table: TransitionTable, to: string): readonly string[] {
  return TRANSITIONS[table]?.(to) ?? [];
}

export function canTransition(table: TransitionTable, from: string, to: string): boolean {
  return allowedFromStatus(table, to).includes(from);
}
