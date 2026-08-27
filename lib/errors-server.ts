/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { errorLogs } from '@/drizzle/schema/support';
import { sendCriticalErrorAlert } from '@/lib/critical-error-alert';

type ErrorLevel = 'warning' | 'error' | 'fatal';

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
}): Promise<void> {
  const msg = opts.error instanceof Error ? opts.error.message : String(opts.error ?? 'Unknown error');
  const stack = opts.error instanceof Error ? opts.error.stack : undefined;
  const source = opts.sourceFile ? null : getSourceLocation();
  try {
    const { db } = await import('@/drizzle/db');
    await db.insert(errorLogs).values({
      tenantId: opts.tenantId ?? null,
      userId: opts.userId ?? null,
      level: opts.level ?? 'error',
      message: msg,
      stack: stack ?? null,
      context: {
        context: opts.context,
        source: opts.sourceFile || (source ? `${source.file}:${source.line} (${source.function})` : null),
        requestUrl: opts.requestUrl,
        requestMethod: opts.requestMethod,
        ...opts.metadata,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[logError] DB write failed:', msg, '|', err.message);
  }

  if (opts.level === 'fatal') {
    sendCriticalErrorAlert({ error: opts.error, level: opts.level, context: opts.context }).catch((e) => console.error('[errors-server] Failed to send critical alert:', e));
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
