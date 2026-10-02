/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { errorLogs } from '@/drizzle/schema/support';
import { sendCriticalErrorAlert } from '@/lib/critical-error-alert';
import { getCurrentRequestId } from '@/lib/tenant/request-context';
import { InvalidJsonBodyError } from '@/lib/errors-shared';
import {
  MAX_STORED_MESSAGE,
  MAX_STORED_STACK,
  errorStackText,
  errorText,
  redactedErrorForSinks,
  redactQueryParams,
  truncateForStore,
} from '@/lib/error-redaction';

type ErrorLevel = 'warning' | 'error' | 'fatal';

// Map our error levels onto Sentry severity levels.
const SENTRY_LEVEL: Record<ErrorLevel, 'warning' | 'error' | 'fatal'> = {
  warning: 'warning',
  error: 'error',
  fatal: 'fatal',
};

/**
 * Best-effort forward to Sentry (#observability). logError is the single funnel
 * every structured server error flows through, but historically it only wrote
 * the DB — so the external "assist" view (Sentry) never saw these errors and
 * there was no way to correlate a DB row with a Sentry event or a request.
 *
 * This forwards the SAME error to Sentry with the requestId as a tag/context so
 * an operator can pivot: superadmin/errors row  ⇄  Sentry issue  ⇄  request id.
 * It is dynamically imported and fully guarded: if Sentry is not installed or
 * not initialized (no DSN), this is a no-op and the DB write is unaffected.
 */
async function forwardToSentry(opts: {
  error: unknown;
  level: ErrorLevel;
  context?: string;
  tenantId?: string;
  userId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  requestUrl?: string;
  requestMethod?: string;
}): Promise<void> {
  try {
    const Sentry = await import('@sentry/nextjs').catch(() => null);
    if (!Sentry?.captureException) return;
    Sentry.captureException(opts.error, {
      level: SENTRY_LEVEL[opts.level],
      tags: {
        source: 'logError',
        context: opts.context,
        requestId: opts.requestId,
        tenantId: opts.tenantId,
      },
      user: opts.userId ? { id: opts.userId } : undefined,
      extra: {
        requestUrl: opts.requestUrl,
        requestMethod: opts.requestMethod,
        ...opts.metadata,
      },
    });
  } catch {
    // Never let observability forwarding break the caller.
  }
}

// Map our error levels onto the Grafana/Loki client's log levels.
const LOKI_LEVEL: Record<ErrorLevel, 'warn' | 'error'> = {
  warning: 'warn',
  error: 'error',
  fatal: 'error',
};

/**
 * Best-effort forward to Grafana Cloud / Loki (#observability). Complements the
 * Sentry forward: Loki gives a queryable log view of the SAME structured errors,
 * with the requestId label so a Loki entry ⇄ error_logs row ⇄ Sentry issue all
 * line up.
 *
 * Gated on GRAFANA_ENABLED==='true' — checked HERE, before touching the client,
 * so when Grafana is off this is a genuine no-op (the client's disabled path
 * would otherwise console.log every error). Dynamically imported and fully
 * guarded so a push failure can never affect the DB write or the caller.
 */
async function forwardToLoki(opts: {
  error: unknown;
  level: ErrorLevel;
  message: string;
  context?: string;
  tenantId?: string;
  userId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  requestUrl?: string;
  requestMethod?: string;
  stack?: string;
}): Promise<void> {
  if (process.env['GRAFANA_ENABLED'] !== 'true') return;
  try {
    const mod = await import('@/lib/grafana').catch(() => null);
    if (!mod?.metrics?.log) return;
    mod.metrics.log(LOKI_LEVEL[opts.level], opts.message, {
      context: opts.context,
      requestId: opts.requestId,
      tenantId: opts.tenantId,
      userId: opts.userId,
      requestUrl: opts.requestUrl,
      requestMethod: opts.requestMethod,
      stack: opts.stack,
      ...opts.metadata,
    });
  } catch {
    // Never let observability forwarding break the caller.
  }
}

function getSourceLocation(): { file: string; line: number; function: string } | null {
  const err = new Error();
  const stack = err.stack?.split('\n');
  if (!stack) return null;
  const caller = stack[3] || stack[2] || '';
  const match = caller.match(/at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):\d+)\)?/);
  if (!match) return null;
  return {
    function: match[1] || '<anonymous>',
    file: match[2] || '',
    line: parseInt(match[3] || '0', 10),
  };
}

/**
 * Walk a wrapped error's `cause` chain collecting what each level knows.
 *
 * Same walk `lib/api/db-client-error.ts` does for status mapping: the SQLSTATE
 * only ever lives on the inner pg error, never on drizzle's QueryFailedError.
 * Bounded so a pathological chain cannot spin, and self-cause guarded.
 */
function errorCauseChain(error: unknown): { code: string | null; message: string; constraint?: string }[] {
  const chain: { code: string | null; message: string; constraint?: string }[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === 'string') {
      chain.push({ code: null, message: current });
      break;
    }
    const e = current as { code?: unknown; sqlstate?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };
    const code = typeof e.code === 'string' ? e.code : typeof e.sqlstate === 'string' ? e.sqlstate : null;
    const text = typeof e.message === 'string' ? redactQueryParams(e.message) : '';
    if (code || text) {
      chain.push({ code, message: text, ...(typeof e.constraint === 'string' ? { constraint: e.constraint } : {}) });
    }
    if (e.cause === current) break;
    current = e.cause;
  }
  return chain;
}

export async function logError(opts: {
  error: unknown;
  context?: string;
  tenantId?: string;
  userId?: string;
  level?: ErrorLevel;
  metadata?: Record<string, unknown>;
  requestUrl?: string;
  requestMethod?: string;
  sourceFile?: string;
  /** Correlation id; defaults to the current request's id from AsyncLocalStorage. */
  requestId?: string;
  /** Set false to skip the external forwards (Sentry + Loki) for a noisy expected error. Default true. The DB row is still written. */
  captureToSentry?: boolean;
}): Promise<void> {
  // A malformed JSON body is the caller's error and every renderer already
  // answers it with a 400. Skipping the error_logs row, the Sentry capture and
  // the critical-alert keeps clients from paging anyone.
  if (opts.error instanceof InvalidJsonBodyError) return;
  const level: ErrorLevel = opts.level ?? 'error';
  const msg = errorText(opts.error);
  // #44: drizzle's node-postgres driver rethrows as QueryFailedError — the SQL
  // text becomes `message` and the pg error, the only object holding the
  // SQLSTATE, moves to `cause`. Storing the top message alone made every RLS
  // refusal, FK violation and CHECK drift read as "Failed query: select …",
  // with the one line that explained it dropped. End the stored message with the
  // root cause and keep the whole chain structured alongside it.
  const causes = errorCauseChain(opts.error);
  const root = causes.length > 0 ? causes[causes.length - 1] : null;
  // #62: that same QueryFailedError appends `params: <every bound value>`, so
  // the stored row carried the tenant's data — 82,345 of the 82,645 characters
  // in the worst preprod row. Redaction happens here, at the one funnel every
  // structured server error flows through, rather than at each call site.
  const message = truncateForStore(
    root && root.message && !msg.includes(root.message)
      ? `${msg} | caused by ${root.code ? `${root.code}: ` : ''}${root.message}`
      : msg,
    MAX_STORED_MESSAGE,
  );
  const stack = truncateForStore(errorStackText(opts.error) ?? '', MAX_STORED_STACK) || undefined;
  const source = opts.sourceFile ? null : getSourceLocation();
  // Correlate the DB row, the Sentry event, and the request. The proxy/auth
  // middleware put the id in AsyncLocalStorage; callers may still override.
  const requestId = opts.requestId ?? getCurrentRequestId();

  try {
    const { db } = await import('@/drizzle/db');
    // #2128: vitest runs sometimes execute against the shared pre-prod DB — an
    // unmocked write from a test pollutes production error_logs and Sentry.
    // Skip the DB mirror in test mode unless the caller mocked `db.insert`
    // (those unit tests legitimately assert the write happened).
    const testMode = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
    const mockedInsert = typeof (db as unknown as { insert?: { _isMockFunction?: unknown } }).insert?.['_isMockFunction'] === 'boolean';
    if (testMode && !mockedInsert) {
      console.log(JSON.stringify({
        source: 'logError.test-mode',
        outcome: 'db_write_skipped',
        level,
        message,
        context: opts.context ?? null,
        requestId: requestId ?? null,
      }));
    } else {
      await db.insert(errorLogs).values({
      tenantId: opts.tenantId ?? null,
      userId: opts.userId ?? null,
      level,
      message,
      stack: stack ?? null,
      context: {
        context: opts.context,
        source: opts.sourceFile || (source ? `${source.file}:${source.line} (${source.function})` : null),
        requestId,
        requestUrl: opts.requestUrl,
        requestMethod: opts.requestMethod,
        ...(causes.length > 0 ? { errorCauses: causes } : {}),
        ...opts.metadata,
      },
    });
    }
 
 
  } catch (err) {
    // #2129: during pool saturation the DB write fails on exactly the worst
    // errors. Never swallow the incident — emit a structured one-line JSON
    // record to stdout so promtail/Loki keep a queryable copy.
    console.error(JSON.stringify({
      source: 'logError.fallback',
      outcome: 'db_write_failed',
      level,
      message,
      context: opts.context ?? null,
      requestId: requestId ?? null,
      tenantId: opts.tenantId ?? null,
      userId: opts.userId ?? null,
      requestUrl: opts.requestUrl ?? null,
      requestMethod: opts.requestMethod ?? null,
      writeFailureCause: err instanceof Error ? err.message : String(err),
      stack: stack ?? null,
    }));
  }

  // External "assist" views — forward the same error out-of-band (best-effort).
  // `captureToSentry:false` quiets BOTH external sinks (Sentry + Loki) for noisy
  // expected errors; the DB row is always written above regardless.
  if (opts.captureToSentry !== false) {
    await forwardToSentry({
      // The raw Error is not passed on: Sentry renders `event.message` from
      // error.message, which for a failed query is the parameter dump. The copy
      // keeps name, stack and the deepest cause (the SQLSTATE).
      error: redactedErrorForSinks(opts.error, message),
      level,
      context: opts.context,
      tenantId: opts.tenantId,
      userId: opts.userId,
      requestId,
      metadata: opts.metadata,
      requestUrl: opts.requestUrl,
      requestMethod: opts.requestMethod,
    });
    await forwardToLoki({
      error: opts.error,
      level,
      message,
      context: opts.context,
      tenantId: opts.tenantId,
      userId: opts.userId,
      requestId,
      metadata: opts.metadata,
      requestUrl: opts.requestUrl,
      requestMethod: opts.requestMethod,
      stack,
    });
  }

  if (level === 'fatal') {
    sendCriticalErrorAlert({ error: opts.error, level, context: opts.context }).catch((e) => console.error('[errors-server] Failed to send critical alert:', e));
  }
}

export async function withErrorLogging<T>(
  fn: () => Promise<T>,
  context: string,
  meta?: { tenantId?: string; userId?: string }
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    await logError({ error: err, context, ...meta });
    return null;
  }
}

/**
 * Safely extract { tenantId, userId } from an auth context that may be a
 * resolved AuthContext, a NextResponse (auth failed), or undefined (requireAuth
 * threw before assignment). Used in catch blocks so #1063 structured logging
 * can attach tenant/user without extra null-checking noise at each call site.
 */
export function tenantMeta(
  ctx: unknown,
): { tenantId?: string; userId?: string } {
  if (ctx && typeof ctx === 'object' && 'tenantId' in ctx) {
    const c = ctx as { tenantId?: string; userId?: string };
    return { tenantId: c.tenantId, userId: c.userId };
  }
  return {};
}
