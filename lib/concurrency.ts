/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
export class ConcurrencyError extends Error {
  override name = "ConcurrencyError";
  statusCode = 409;
  entity: string;

  constructor(entity: string) {
    super(
      `${entity} was modified by another request. Please refresh and try again.`
    );
    this.entity = entity;
  }
}

/**
 * Thrown when a caller opts into the optimistic-concurrency check by passing an
 * `expectedUpdatedAt`, but that value is missing or not a parseable timestamp.
 *
 * Silently skipping the check on an unparseable value is how a client bypasses
 * concurrency control — by accident or on purpose — so we fail loudly instead of
 * letting an unguarded write through. `apiError()` maps this to a 400.
 */
export class InvalidExpectedUpdatedAtError extends Error {
  override name = "InvalidExpectedUpdatedAtError";
  statusCode = 400;

  constructor() {
    super("Invalid expectedUpdatedAt — must be an ISO 8601 timestamp.");
  }
}

/**
 * Wraps a Drizzle `.returning()` update call that implements optimistic locking
 * and throws a {@link ConcurrencyError} when the WHERE clause matched zero rows
 * (i.e. another request modified the entity first, or it was deleted).
 *
 * The optimistic-lock comparison itself must live in the update's WHERE clause,
 * built with {@link import('./api/concurrency').updatedAtMs} so the timestamp
 * survives the JS/pg millisecond round-trip:
 *
 *   const [row] = await withConcurrencyGuard(
 *     () => db.update(leads)
 *       .set({ ... })
 *       .where(and(eq(leads.id, id), updatedAtMs(leads, expectedUpdatedAt)))
 *       .returning(),
 *     "Lead",
 *     expectedUpdatedAt,
 *   );
 *
 * `expectedUpdatedAt` is validated here (not merely documentation): a caller that
 * opts into the guard MUST supply a parseable timestamp. If it is missing or
 * unparseable we throw {@link InvalidExpectedUpdatedAtError} rather than run an
 * update whose `updatedAtMs(...)` predicate would silently compare against an
 * invalid date and let a stale write through.
 *
 * A zero-row result is reported as a 409 conflict via {@link ConcurrencyError}.
 * That merges the "row is gone" (404) and "row moved on" (409) cases into a
 * single 409; callers that need to distinguish the two can pre-check existence
 * (most already load the row to read its `updatedAt`) and answer 404 themselves.
 */
export async function withConcurrencyGuard<T>(
  updateFn: () => Promise<T[]>,
  entity: string,
  expectedUpdatedAt: string | Date
): Promise<T[]> {
  // A caller passing expectedUpdatedAt is opting into the concurrency check.
  // Reject a missing or unparseable value up front instead of proceeding with an
  // update whose updatedAtMs(...) predicate cannot enforce anything.
  if (expectedUpdatedAt === undefined || expectedUpdatedAt === null) {
    throw new InvalidExpectedUpdatedAtError();
  }
  const timestamp =
    expectedUpdatedAt instanceof Date ? expectedUpdatedAt : new Date(expectedUpdatedAt);
  if (Number.isNaN(timestamp.getTime())) {
    throw new InvalidExpectedUpdatedAtError();
  }

  const result = await updateFn();

  if (result.length === 0) {
    throw new ConcurrencyError(entity);
  }

  return result;
}
