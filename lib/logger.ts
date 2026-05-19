import fs from 'fs';
import path from 'path';

/**
 * Structured Logger (replaces console.log/error)
 * Fixes: MON-004 (structured JSON logging), REL-001 (no silent failures)
 *
 * Usage:
 *   logger.info('User logged in', { userId, ip })
 *   logger.error('DB connection failed', { error: err.message, stack: err.stack })
 */

const LOG_FILE = path.join(process.cwd(), 'nucrm.log');

function writeToFile(logEntry: any) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    const logEntry = { level: 'info', ts: new Date().toISOString(), msg: message, ...meta };
    console.log(JSON.stringify(logEntry));
    writeToFile(logEntry);
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    const logEntry = { level: 'warn', ts: new Date().toISOString(), msg: message, ...meta };
    console.warn(JSON.stringify(logEntry));
    writeToFile(logEntry);
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    const logEntry = { level: 'error', ts: new Date().toISOString(), msg: message, ...meta };
    console.error(JSON.stringify(logEntry));
    writeToFile(logEntry);
  },
};

/**
 * Safe error handler — never leaks internal messages to clients
 * Fixes: SEC-019 (no internal error leakage)
 */
export function safeError(err: unknown, context: string): { message: string; code: string } {
  // Always log full details server-side
  logger.error(`[${context}] Error`, {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  // Return sanitized error for clients
  if (err instanceof Error) {
    // Never expose stack traces or internal DB errors
    return { message: 'An internal error occurred', code: 'INTERNAL_ERROR' };
  }
  return { message: 'An unexpected error occurred', code: 'UNKNOWN_ERROR' };
}
