/**
 * Database Query Retry Logic
 *
 * Retries transient database errors (deadlock, serialization failure,
 * connection drop) with exponential backoff. Does NOT retry non-transient
 * errors (syntax, constraint violation, FK violation).
 *
 * Usage:
 * ```ts
 * const result = await withRetry(() => db.select().from(users).where(...));
 * ```
 */

/** Errors that are transient and safe to retry */
const TRANSIENT_ERROR_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
]);

/** Error messages that indicate transient failures */
const TRANSIENT_MESSAGE_PATTERNS = [
  'connection terminated',
  'connection refused',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'socket hang up',
  'too many connections',
  'remaining connection slots',
];

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  // Check PostgreSQL error code
  const code = (err as Record<string, unknown>).code;
  if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) return true;

  // Check error message patterns
  const message = (err as Record<string, unknown>).message;
  if (typeof message === 'string') {
    return TRANSIENT_MESSAGE_PATTERNS.some(pattern =>
      message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  return false;
}

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in milliseconds (doubles each retry) */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
};

/**
 * Execute a database operation with retry logic for transient errors.
 *
 * @param fn - The async function to execute
 * @param config - Optional retry configuration
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry non-transient errors
      if (!isTransientError(err)) {
        throw err;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        throw err;
      }

      // Exponential backoff with jitter
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = delay * 0.1 * Math.random(); // 10% jitter
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError;
}

export { isTransientError };
