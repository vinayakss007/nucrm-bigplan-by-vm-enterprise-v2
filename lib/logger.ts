import fs from 'fs';
import path from 'path';
import { getCurrentRequestId } from '@/lib/tenant/request-context';
import { streamLog } from '@/lib/log-stream';

/**
 * Structured Logger (replaces console.log/error)
 * Fixes: MON-004 (structured JSON logging), REL-001 (no silent failures)
 * MON-010: requestId is auto-injected from AsyncLocalStorage context
 *
 * Usage:
 *   logger.info('User logged in', { userId, ip })
 *   logger.error('DB connection failed', { error: err.message, stack: err.stack })
 */

const LOG_FILE = path.join(process.cwd(), 'nucrm.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 5;

function rotateLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size < MAX_LOG_SIZE) return;

    const oldest = LOG_FILE + '.' + MAX_LOG_FILES;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);

    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const oldName = LOG_FILE + '.' + i;
      const newName = LOG_FILE + '.' + (i + 1);
      if (fs.existsSync(oldName)) fs.renameSync(oldName, newName);
    }

    fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch (err) {
    console.error('Failed to rotate log file:', err);
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeToFile(logEntry: any) {
  try {
    rotateLogs();
    fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

function enrich(meta?: Record<string, unknown>): Record<string, unknown> {
  const requestId = getCurrentRequestId();
  if (!requestId) return meta ?? {};
  return { requestId, ...meta };
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    const logEntry = { level: 'info', ts: new Date().toISOString(), msg: message, ...enrich(meta) };
    console.log(JSON.stringify(logEntry));
    writeToFile(logEntry);
    streamLog('info', message, enrich(meta));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    const logEntry = { level: 'warn', ts: new Date().toISOString(), msg: message, ...enrich(meta) };
    console.warn(JSON.stringify(logEntry));
    writeToFile(logEntry);
    streamLog('warn', message, enrich(meta));
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    const logEntry = { level: 'error', ts: new Date().toISOString(), msg: message, ...enrich(meta) };
    console.error(JSON.stringify(logEntry));
    writeToFile(logEntry);
    streamLog('error', message, enrich(meta));
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
