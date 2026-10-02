/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextResponse } from 'next/server';
import { eq, and, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgTable, PgColumn } from 'drizzle-orm/pg-core';

type AppDb = (typeof import('@/drizzle/db'))['db'];

type GuardableColumns = {
  id?: PgColumn;
  tenantId?: PgColumn;
  parentTenantId?: PgColumn;
  deletedAt?: PgColumn;
  updatedAt?: PgColumn;
};

/**
 * Optimistic concurrency guard — two overloads:
 *
 * 1. concurrencyGuard(table, expectedUpdatedAt)
 *    Returns a SQL fragment for use in .where(), or null if no expectedUpdatedAt.
 *
 * 2. concurrencyGuard(db, table, id, tenantId, expectedUpdatedAt)
 *    Reads the DB row and compares timestamps. Returns null to proceed, or a
 *    NextResponse: 409 if the row moved on, 404 if it is gone, 400 if
 *    expectedUpdatedAt could not be parsed.
 *
 * Both overloads pass (return null) when expectedUpdatedAt is absent -- sending it
 * is what opts a request into the check.
 *
 * Neither overload can guard a table that has no updatedAt column; they return null
 * and the update proceeds. Check the table before relying on this for a new route.
 */

// Overload 1: SQL fragment (no db)
export function concurrencyGuard(
  table: AnyPgTable,
  expectedUpdatedAt: string | Date | null | undefined,
): SQL<unknown> | null;

// Overload 2: NextResponse guard (with db)
export function concurrencyGuard(
  db: AppDb,
  table: AnyPgTable,
  id: string | undefined | null,
  tenantId: string | undefined | null,
  expectedUpdatedAt: Date | string | null | undefined,
): Promise<NextResponse | null>;

export function concurrencyGuard(
  dbOrTable: AppDb | AnyPgTable,
  tableOrExpected: AnyPgTable | Date | string | null | undefined,
  idOrUndefined?: string | null,
  tenantIdOrUndefined?: string | null,
  expectedUpdatedAtOrUndefined?: Date | string | null,
): SQL<unknown> | null | Promise<NextResponse | null> {
  // Detect overload 1 (2 args, no db): table + expectedUpdatedAt
  if (idOrUndefined === undefined && tenantIdOrUndefined === undefined && expectedUpdatedAtOrUndefined === undefined) {
    const table = dbOrTable as AnyPgTable & GuardableColumns;
    const expectedUpdatedAt = tableOrExpected as Date | string | null | undefined;

    if (!expectedUpdatedAt) return null;

    const timestamp = new Date(expectedUpdatedAt);
    if (isNaN(timestamp.getTime())) return null;

    const updatedAtCol = table.updatedAt;
    if (!updatedAtCol) return null;

    // NOT eq(updatedAtCol, timestamp). Postgres keeps microseconds in
    // `timestamptz`; a JS Date stops at milliseconds. Any row whose
    // updated_at was written by the database (`default now()`, a `NOW()`
    // migration, an insert in raw SQL) therefore carries sub-millisecond
    // digits, and the equality can never match — the guarded UPDATE affects
    // 0 rows and the caller reports a 409 that no client can clear by
    // retrying. Branding failed this way for every freshly provisioned
    // tenant. Truncating both sides also matches what the client can
    // actually send back: expectedUpdatedAt arrives as an ISO string, which
    // is millisecond precision by definition.
    return updatedAtMs(table, timestamp);
  }

  // Overload 2 (5 args): db + table + id + tenantId + expectedUpdatedAt
  return concurrencyGuardAsync(
    dbOrTable as AppDb,
    tableOrExpected as AnyPgTable,
    idOrUndefined,
    tenantIdOrUndefined,
    expectedUpdatedAtOrUndefined,
  );
}

async function concurrencyGuardAsync(
  db: AppDb,
  table: AnyPgTable,
  id: string | undefined | null,
  tenantId: string | undefined | null,
  expectedUpdatedAt: Date | string | null | undefined,
): Promise<NextResponse | null> {
  if (!expectedUpdatedAt || !id) return null;

  const timestamp = new Date(expectedUpdatedAt);
  if (isNaN(timestamp.getTime())) {
    // Do not fall through to an unguarded update. A caller that sent
    // expectedUpdatedAt asked for the check, and silently skipping it on a value
    // we could not parse is how a client bypasses concurrency control by
    // accident -- or on purpose.
    return NextResponse.json(
      { error: 'Invalid expectedUpdatedAt — must be an ISO 8601 timestamp.' },
      { status: 400 },
    );
  }

  const cols = table as AnyPgTable & GuardableColumns;
  const idCol = cols.id;
  const tenantCol = cols.tenantId ?? cols.parentTenantId;
  const deletedCol = cols.deletedAt;
  const updatedAtCol = cols.updatedAt;

  if (!idCol || !updatedAtCol) return null;

  const conditions = [eq(idCol, id)];
  if (tenantCol && tenantId) {
    conditions.push(eq(tenantCol, tenantId));
  }
  if (deletedCol) {
    // isNull, not eq(col, null). eq() binds null as a parameter and emits
    // `deleted_at = $n`, and in SQL `x = NULL` is never true -- so this predicate
    // matched no rows at all and every guarded update answered 404.
    conditions.push(isNull(deletedCol));
  }

  const [row] = await db
    .select({ updatedAt: updatedAtCol })
    .from(table)
    .where(and(...conditions))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { error: 'Record not found' },
      { status: 404 },
    );
  }

  const dbTime = new Date(row.updatedAt as Date | string);
  const clientTime = new Date(timestamp);

  if (dbTime.getTime() !== clientTime.getTime()) {
    return NextResponse.json(
      { error: 'Stale data — this record was modified by another user. Please refresh and retry.' },
      { status: 409 },
    );
  }

  return null;
}

/**
 * Same as concurrencyGuard but without tenant scoping.
 */
export async function concurrencyGuardById(
  db: AppDb,
  table: AnyPgTable,
  id: string | undefined | null,
  expectedUpdatedAt: Date | string | null | undefined,
): Promise<NextResponse | null> {
  return concurrencyGuardAsync(db, table, id, null, expectedUpdatedAt);
}

/**
 * Returns a SQL fragment that compares `table.updatedAt` with `expected`,
 * truncating both to millisecond precision so the comparison survives the
 * JS/pg driver round-trip (pg stores microseconds, JS Date has only ms).
 *
 * Use this instead of `eq(table.updatedAt, expected)` in UPDATE … WHERE clauses
 * that implement optimistic locking via `withConcurrencyGuard`.
 *
 * Example:
 *   .where(and(eq(deals.id, id), updatedAtMs(deals, prev.updatedAt!)))
 */
export function updatedAtMs(
  table: AnyPgTable,
  expected: Date | string,
): SQL<unknown> {
  const ts = expected instanceof Date ? expected : new Date(expected);
  const updatedAtCol = (table as AnyPgTable & GuardableColumns).updatedAt;
  return sql`date_trunc('millisecond', ${updatedAtCol}::timestamptz) = date_trunc('millisecond', ${ts}::timestamptz)`;
}

/**
 * Check if an update affected 0 rows and return a 409 Conflict response if so.
 */
export function checkStaleUpdate(updated: unknown): NextResponse | null {
  if (!updated) {
    return NextResponse.json(
      { error: 'Stale data — this record was modified by another user. Please refresh and retry.' },
      { status: 409 },
    );
  }
  return null;
}
