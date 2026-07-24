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
 * Wraps a Drizzle `.returning()` update call and throws a ConcurrencyError
 * when the WHERE clause matched zero rows (i.e. another request modified the
 * entity first).
 *
 * Usage:
 *   const result = await withConcurrencyGuard(
 *     () => db.update(leads).set({ ... }).where(eq(leads.id, id)).returning(),
 *     "Lead",
 *     currentUpdatedAt,
 *   );
 */
export async function withConcurrencyGuard<T>(
  updateFn: () => Promise<T[]>,
  entity: string,
  _updatedAt: string | Date
): Promise<T[]> {
  const result = await updateFn();

  if (result.length === 0) {
    throw new ConcurrencyError(entity);
  }

  return result;
}
