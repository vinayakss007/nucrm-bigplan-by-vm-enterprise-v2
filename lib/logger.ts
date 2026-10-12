/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import fs from 'fs';
import path from 'path';
import { getCurrentRequestId } from '@/lib/tenant/request-context';
import { streamLog } from '@/lib/log-stream';
import { redactQueryParams, redactedErrorForSinks } from '@/lib/error-redaction';

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

let logFileBusy = false;

async function rotateLogs(): Promise<void> {
  try {
    const stats = await fs.promises.stat(LOG_FILE).catch(() => null);
    if (!stats || stats.size < MAX_LOG_SIZE) return;

    const oldest = LOG_FILE + '.' + MAX_LOG_FILES;
    await fs.promises.unlink(oldest).catch(() => {});

    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const oldName = LOG_FILE + '.' + i;
      const newName = LOG_FILE + '.' + (i + 1);
      await fs.promises.rename(oldName, newName).catch(() => {});
    }

    await fs.promises.rename(LOG_FILE, LOG_FILE + '.1');
  } catch (err) {
    console.error('Failed to rotate log file:', err);
  }
}

 
function writeToFile(logEntry: Record<string, unknown>) {
  if (logFileBusy) return;
  logFileBusy = true;
  rotateLogs()
    .then(() => fs.promises.appendFile(LOG_FILE, JSON.stringify(logEntry) + '\n'))
    .catch((err) => console.error('Failed to write to log file:', err))
    .finally(() => { logFileBusy = false; });
}

function enrich(meta?: Record<string, unknown>): Record<string, unknown> {
  const requestId = getCurrentRequestId();
  if (!requestId) return meta ?? {};
  return { requestId, ...meta };
}

/**
 * #62: the shape almost every catch block logs is `{ error: err.message }`, and
 * a failed query's message ends with every value bound into it. These lines go
 * to stdout, nucrm.log and Loki, so redact at the one place all three are
 * written instead of asking 40 call sites to remember.
 */
function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactQueryParams(value);
  if (value instanceof Error) return redactedErrorForSinks(value, redactQueryParams(value.message));
  return value;
}

function redactMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return meta;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) out[key] = redactValue(value);
  return out;
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    const safeMessage = redactQueryParams(message);
    const extra = enrich(redactMeta(meta));
    const logEntry = { level: 'info', ts: new Date().toISOString(), msg: safeMessage, ...extra };
    console.log(JSON.stringify(logEntry));
    writeToFile(logEntry);
    streamLog('info', safeMessage, extra);
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    const safeMessage = redactQueryParams(message);
    const extra = enrich(redactMeta(meta));
    const logEntry = { level: 'warn', ts: new Date().toISOString(), msg: safeMessage, ...extra };
    console.warn(JSON.stringify(logEntry));
    writeToFile(logEntry);
    streamLog('warn', safeMessage, extra);
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    const safeMessage = redactQueryParams(message);
    const extra = enrich(redactMeta(meta));
    const logEntry = { level: 'error', ts: new Date().toISOString(), msg: safeMessage, ...extra };
    console.error(JSON.stringify(logEntry));
    writeToFile(logEntry);
    streamLog('error', safeMessage, extra);
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
