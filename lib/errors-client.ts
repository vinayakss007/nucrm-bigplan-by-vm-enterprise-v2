export { ErrorCode, type ApiError, type ErrorLevel } from '@/lib/errors-shared';

export async function logError(opts: { error: unknown; context?: string; [key: string]: unknown }): Promise<void> {
  console.error(`[logError] ${opts.context ?? ''}`, opts.error);
}

export async function withErrorLogging<T>(fn: () => Promise<T>, context: string, metadata?: Record<string, unknown>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    logError({ error: err, context, ...metadata });
    return null;
  }
}
