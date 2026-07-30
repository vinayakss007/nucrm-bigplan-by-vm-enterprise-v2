/**
 * Query Timeout Enforcement
 *
 * Wraps database queries with a timeout. If the query takes longer than
 * the threshold, it rejects with a TimeoutError. The actual PostgreSQL
 * query continues (PG will cancel it on connection close), but the
 * caller gets an immediate error instead of hanging.
 *
 * Usage:
 * ```ts
 * const result = await withTimeout(
 *   () => db.select().from(contacts).where(...),
 *   { timeoutMs: 5000, operation: 'contacts.list' }
 * );
 * ```
 */

export class QueryTimeoutError extends Error {
  public readonly operation: string;
  public readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Query timeout: "${operation}" exceeded ${timeoutMs}ms`);
    this.name = 'QueryTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Execute a database operation with a timeout.
 *
 * @param fn - The async function to execute
 * @param options - Operation name and timeout in ms
 * @returns The result of the function
 * @throws QueryTimeoutError if the operation exceeds the timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  options?: { timeoutMs?: number; operation?: string }
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const operation = options?.operation ?? 'unknown';

  return new Promise<T>((resolve, reject) => {
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      reject(new QueryTimeoutError(operation, timeoutMs));
    }, timeoutMs);

    fn()
      .then((result) => {
        if (!timedOut) {
          clearTimeout(timer);
          resolve(result);
        }
      })
      .catch((err) => {
        if (!timedOut) {
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}
