/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { errorLogs } from '@/drizzle/schema/support';
import { sendCriticalErrorAlert } from '@/lib/critical-error-alert';
import { getCurrentRequestId } from '@/lib/tenant/request-context';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  level: ErrorLevel;
  context?: string;
  tenantId?: string;
  userId?: string;
  requestId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user: opts.userId ? ({ id: opts.userId } as any) : undefined,
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

export async function logError(opts: {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  context?: string;
  tenantId?: string;
  userId?: string;
  level?: ErrorLevel;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  requestUrl?: string;
  requestMethod?: string;
  sourceFile?: string;
  /** Correlation id; defaults to the current request's id from AsyncLocalStorage. */
  requestId?: string;
  /** Set false to skip the Sentry forward (e.g. a noisy expected error). Default true. */
  captureToSentry?: boolean;
}): Promise<void> {
  const level: ErrorLevel = opts.level ?? 'error';
  const msg = opts.error instanceof Error ? opts.error.message : String(opts.error ?? 'Unknown error');
  const stack = opts.error instanceof Error ? opts.error.stack : undefined;
  const source = opts.sourceFile ? null : getSourceLocation();
  // Correlate the DB row, the Sentry event, and the request. The proxy/auth
  // middleware put the id in AsyncLocalStorage; callers may still override.
  const requestId = opts.requestId ?? getCurrentRequestId();
  try {
    const { db } = await import('@/drizzle/db');
    await db.insert(errorLogs).values({
      tenantId: opts.tenantId ?? null,
      userId: opts.userId ?? null,
      level,
      message: msg,
      stack: stack ?? null,
      context: {
        context: opts.context,
        source: opts.sourceFile || (source ? `${source.file}:${source.line} (${source.function})` : null),
        requestId,
        requestUrl: opts.requestUrl,
        requestMethod: opts.requestMethod,
        ...opts.metadata,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[logError] DB write failed:', msg, '|', err.message);
  }

  // External "assist" view — forward the same error to Sentry (best-effort).
  if (opts.captureToSentry !== false) {
    await forwardToSentry({
      error: opts.error,
      level,
      context: opts.context,
      tenantId: opts.tenantId,
      userId: opts.userId,
      requestId,
      metadata: opts.metadata,
      requestUrl: opts.requestUrl,
      requestMethod: opts.requestMethod,
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
