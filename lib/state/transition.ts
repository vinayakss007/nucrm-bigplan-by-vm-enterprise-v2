/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 PR-4A — the single owner of a status write.
 *
 * A status is not a value to set; it is a transition to claim. The four legacy
 * helpers (CAS-in-WHERE, optimistic updatedAt, read-check-write and "just
 * update") each re-encoded that rule per route and let a concurrent writer win.
 * This helper emits one shape: the UPDATE carries id, tenant, from-state and
 * the tombstone gate in its WHERE, so Postgres re-evaluates the claim under the
 * row lock. Zero rows means the transition was lost, never "nothing to do".
 *
 * Callers pass the allowed from-states from `lib/state/transitions.ts`, so the
 * JS guard and the SQL claim read the same rule.
 */
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { AnyPgTable, PgColumn } from 'drizzle-orm/pg-core';

type AppDb = (typeof import('@/drizzle/db'))['db'];
/** A db handle or a transaction — both expose update/select identically. */
export type TransitionDb = Pick<AppDb, 'update' | 'select'>;

/** The columns every guarded status write needs. */
type StatusTable = AnyPgTable & {
  id: PgColumn;
  status: PgColumn;
  tenantId?: PgColumn;
  deletedAt?: PgColumn;
};

export interface TransitionArgs {
  table: AnyPgTable;
  id: string;
  /** Omit only for a genuinely global table; every tenant table must pass it. */
  tenantId?: string;
  /** The from-states the caller validated. Empty means no transition is legal. */
  from: readonly string[];
  to: string;
  /** Caller-owned fields (updatedAt, updatedBy, timestamps, side-effect columns). */
  patch?: Record<string, unknown>;
  extraWhere?: SQL;
}

export type TransitionOutcome =
  | { ok: true; row: unknown }
  | { ok: false; reason: 'not_found' | 'conflict' };

/**
 * Claim `from → to` atomically. Returns the updated row, or a classified
 * failure so the caller can answer 404 (gone) or 409 (someone else moved it).
 */
export async function transitionStatus(
  db: TransitionDb,
  args: TransitionArgs,
): Promise<TransitionOutcome> {
  const { table, id, tenantId, from, to, patch, extraWhere } = args;
  const cols = table as StatusTable;

  const identity: SQL[] = [eq(cols.id, id)];
  if (tenantId !== undefined && cols.tenantId) identity.push(eq(cols.tenantId, tenantId));
  if (cols.deletedAt) identity.push(isNull(cols.deletedAt));

  const claim: SQL[] = [
    ...identity,
    inArray(cols.status, [...from]),
    ...(extraWhere ? [extraWhere] : []),
  ];
  // One statement, no read-check-write gap: the caller already vetted the
  // from-state, and Postgres re-evaluates this WHERE under the row lock. A
  // second classifying read would only add another chance to race, so zero
  // rows is always reported as a lost claim.
  const [row] = await db
    .update(table)
    .set({ ...(patch ?? {}), status: to })
    .where(and(...claim))
    .returning();

  return row ? { ok: true, row } : { ok: false, reason: 'conflict' };
}

export interface TransitionManyArgs extends Omit<TransitionArgs, 'id'> {
  /** The ids in one from-state group; empty means no rows can be claimed. */
  ids: readonly string[];
}

/**
 * Bulk form of the same claim. One statement per from-state group keeps the
 * registry-supplied from-state in the WHERE; a concurrent edit loses its row
 * and simply does not appear in `rows`, which the caller reports as skipped.
 */
export async function transitionStatusMany(
  db: TransitionDb,
  args: TransitionManyArgs,
): Promise<{ rows: unknown[] }> {
  const { table, ids, tenantId, from, to, patch, extraWhere } = args;
  const cols = table as StatusTable;
  const claim: SQL[] = [
    inArray(cols.id, [...ids]),
    ...(tenantId !== undefined && cols.tenantId ? [eq(cols.tenantId, tenantId)] : []),
    ...(cols.deletedAt ? [isNull(cols.deletedAt)] : []),
    inArray(cols.status, [...from]),
    ...(extraWhere ? [extraWhere] : []),
  ];
  const rows = await db
    .update(table)
    .set({ ...(patch ?? {}), status: to })
    .where(and(...claim))
    .returning();
  return { rows };
}

/** Map a lost claim to the HTTP contract callers must use. */
export function transitionStatusResponse(
  entity: string,
  from: readonly string[],
  to: string,
  outcome: Exclude<TransitionOutcome, { ok: true }>,
): NextResponse {
  return NextResponse.json(
    outcome.reason === 'not_found'
      ? { error: `${entity} not found.` }
      : {
          error:
            `${entity} status changed concurrently — cannot move from ` +
            `[${from.join(', ')}] to '${to}'. Reload and retry.`,
        },
    { status: outcome.reason === 'not_found' ? 404 : 409 },
  );
}
