/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Per-table status-transition registry (#3407 PR-4A).
 *
 * Status columns are `text` with, at best, a value-vocabulary `CHECK` — the
 * TRANSITION rule lived re-encoded in each route, differently per route:
 * orders and contracts kept a private `VALID_TRANSITIONS` map, invoices vetted
 * vocabulary and ledger-ownership only, tickets vetted nothing. Four
 * concurrency helpers and ~134 write sites later, the same entity answered
 * 400, 409, or "silent no-op" depending on which route got there first.
 *
 * This file is the one place that says which status each table can have and
 * which status it may move to. A route that needs the answer asks here;
 * `guard:status-transitions` fails any registry table whose status is written
 * anywhere `transitionStatus()` does not run. The maps are seeded
 * behaviour-preserving: orders/contracts copy their old inline maps verbatim,
 * invoices keep their vocabulary-only vetting (every declared status is a
 * legal target from every declared status — the edge tightening is a separate,
 * visible-change decision, see #3407 "Risk"), tickets encode the close/reopen
 * edges the #3354 claim already enforced.
 */
import { contracts, invoices, orders, supportTickets } from '@/drizzle/schema';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** A declared lifecycle: what the column is called and where it may go. */
export interface StatusLifecycle {
  /** Physical table name — messages and the generated CHECK use it. */
  table: string;
  /** Physical column name (`status` everywhere except leads' `lead_status`). */
  column: string;
  /** The values the DB CHECK admits; `transitionStatus` refuses others with 400. */
  vocabulary: readonly string[];
  /**
   * from → legal targets. Terminal states map to `[]`; a from-state missing
   * here (e.g. a row whose stored status fell out of use) is refused loudly —
   * #3184's `draft`-not-a-key lookup silently waved every write through.
   */
  edges: Readonly<Record<string, readonly string[]>>;
  /** The row identity columns the claim keys on. */
  columns: {
    id: PgColumn;
    tenantId: PgColumn;
    status: PgColumn;
    /** Tombstone gate when the table soft-deletes; the claim adds `IS NULL`. */
    deletedAt?: PgColumn;
  };
  /**
   * Statuses written by a computation the request does not own (invoice
   * paid/partially_paid recompute from the payment ledger, #2226). Routes
   * refuse direct writes to these; the ledger owner may still write them
   * through `transitionStatus` with an explicit from-set.
   */
  derived?: readonly string[];
}

const INVOICE_STATUSES = [
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled',
  'partially_paid',
  'written_off',
  'pending',
  'void',
] as const;

/** vocabulary × vocabulary, identity included: every status may be re-set to
 * itself (a same-status PUT still CLAIMS — #3346's resurrection guard). */
function fullMatrix(vocabulary: readonly string[]): Record<string, readonly string[]> {
  return Object.fromEntries(vocabulary.map((from) => [from, [...vocabulary]]));
}

export const TRANSITIONS: Readonly<Record<string, StatusLifecycle>> = {
  invoices: {
    table: 'invoices',
    column: 'status',
    vocabulary: INVOICE_STATUSES,
    edges: fullMatrix(INVOICE_STATUSES),
    derived: ['paid', 'partially_paid', 'written_off'],
    columns: {
      id: invoices.id,
      tenantId: invoices.tenantId,
      status: invoices.status,
      deletedAt: invoices.deletedAt,
    },
  },
  // #3184's orders/[id] VALID_TRANSITIONS, verbatim — including `draft`, the
  // key whose absence turned the whole vet into a no-op for new orders.
  orders: {
    table: 'orders',
    column: 'status',
    vocabulary: ['draft', 'pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    edges: {
      draft: ['processing', 'cancelled'],
      pending: ['processing', 'cancelled'],
      processing: ['shipped', 'cancelled'],
      shipped: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
    },
    columns: {
      id: orders.id,
      tenantId: orders.tenantId,
      status: orders.status,
      deletedAt: orders.deletedAt,
    },
  },
  // #3189's inline map, verbatim, plus the same-status admission the route
  // gave by only vetting `status !== existing.status` — a claim of `active`
  // against an `active` row must stay legal.
  contracts: {
    table: 'contracts',
    column: 'status',
    vocabulary: ['draft', 'active', 'suspended', 'terminated', 'expired', 'renewed', 'cancelled'],
    edges: {
      draft: ['draft', 'active', 'cancelled'],
      active: ['active', 'suspended', 'terminated', 'expired', 'renewed'],
      suspended: ['suspended', 'active', 'terminated'],
      renewed: ['renewed', 'active'],
      expired: ['expired'],
      terminated: ['terminated'],
      cancelled: ['cancelled'],
    },
    columns: {
      id: contracts.id,
      tenantId: contracts.tenantId,
      status: contracts.status,
      deletedAt: contracts.deletedAt,
    },
  },
  // drizzle/schema/support.ts:112 — 'open', 'in_progress', 'resolved',
  // 'closed'. The reopen claim (#3354) says resolved → open is legal;
  // closing is the reverse family; `closed` is terminal (the replies route
  // answers a closed ticket 409, it does not reopen it).
  support_tickets: {
    table: 'support_tickets',
    column: 'status',
    vocabulary: ['open', 'in_progress', 'resolved', 'closed'],
    edges: {
      open: ['open', 'in_progress', 'resolved', 'closed'],
      in_progress: ['in_progress', 'open', 'resolved', 'closed'],
      resolved: ['resolved', 'open', 'closed'],
      closed: ['closed'],
    },
    columns: {
      id: supportTickets.id,
      tenantId: supportTickets.tenantId,
      status: supportTickets.status,
      deletedAt: supportTickets.deletedAt,
    },
  },
};

/** Registry keyed by PHYSICAL table name, for the screen's call-site match. */
export function lifecycleForTable(table: string): StatusLifecycle | undefined {
  return Object.values(TRANSITIONS).find((spec) => spec.table === table);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly spec: StatusLifecycle,
    readonly from: readonly string[],
    readonly to: string,
    reason: string,
  ) {
    super(`Invalid status transition on ${spec.table}: cannot move '${from.join("'/'")}' to '${to}' — ${reason}`);
    this.name = 'IllegalTransitionError';
  }
}

/**
 * The registry's one legality question: may a row in any of `from` move to
 * `to`? Everything else — vocabulary membership, unknown from-states, terminal
 * states — is a refusal with a message that names itself, so a 400 never looks
 * like #3184's undefined-lookup shrug.
 */
export function assertLegal(spec: StatusLifecycle, from: readonly string[], to: string): void {
  if (!spec.vocabulary.includes(to)) {
    throw new IllegalTransitionError(spec, from, to, `'${to}' is not in the ${spec.table} vocabulary (${spec.vocabulary.join(', ')})`);
  }
  if (from.length === 0) {
    throw new IllegalTransitionError(spec, from, to, 'a transition needs at least one from-state to claim');
  }
  for (const state of from) {
    const targets = spec.edges[state];
    if (!targets) {
      throw new IllegalTransitionError(spec, from, to, `'${state}' is not a declared ${spec.table} status — refusing instead of waving an unknown state through`);
    }
    if (!targets.includes(to)) {
      const options = targets.length > 0 ? targets.join(', ') : 'none (terminal state)';
      throw new IllegalTransitionError(spec, from, to, `legal targets from '${state}': ${options}`);
    }
  }
}
