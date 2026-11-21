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
type WritableDb = Pick<AppDb, 'update' | 'select'>;

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
  db: WritableDb,
  args: TransitionArgs,
): Promise<TransitionOutcome> {
  const { table, id, tenantId, from, to, patch, extraWhere } = args;
  const cols = table as StatusTable;

  const identity: SQL[] = [eq(cols.id, id)];
  if (tenantId !== undefined && cols.tenantId) identity.push(eq(cols.tenantId, tenantId));
  if (cols.deletedAt) identity.push(isNull(cols.deletedAt));

  // Existence is checked only to classify the failure. The write below is the
  // authoritative guard — this read is never used to decide whether to update.
  const [existing] = await db
    .select({ id: cols.id })
    .from(table)
    .where(and(...identity))
    .limit(1);

  if (!existing) return { ok: false, reason: 'not_found' };

  const claim: SQL[] = [
    ...identity,
    inArray(cols.status, [...from]),
    ...(extraWhere ? [extraWhere] : []),
  ];
  const [row] = await db
    .update(table)
    .set({ ...(patch ?? {}), status: to })
    .where(and(...claim))
    .returning();

  return row ? { ok: true, row } : { ok: false, reason: 'conflict' };
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
