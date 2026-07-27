import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { logError } from '@/lib/errors';
import { sendCriticalErrorAlert } from '@/lib/critical-error-alert';
import { InvalidJsonBodyError } from '@/lib/api/validate';

/**
 * Centralized API error handler.
 *
 * SECURITY: Never exposes internal error messages in production.
 * In development, includes the real message for debugging.
 * Always reports 5xx errors to Sentry.
 *
 * Usage:
// eslint-disable-next-line @typescript-eslint/no-explicit-any
 *   } catch (err: any) { return apiError(err); }
 */
export function apiError(err: unknown, message = 'Internal server error', status = 500) {
  const isDev = process.env.NODE_ENV === 'development';
  const errMsg = err instanceof Error ? err.message : String(err);

  // A malformed request body is the caller's fault, not a server fault. Routes
  // parse with readJsonBody() which raises this tagged error, so we can answer
  // 400 without guessing — and without paging anyone, since there is nothing
  // for an operator to fix. Checked before `status` is honoured because callers
  // pass a hardcoded 500 from their catch block.
  if (err instanceof InvalidJsonBodyError) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Use centralized logError (coordinates with errors.ts)
  logError({ error: err, context: `apiError:${status}` });

  // Report to Sentry for 5xx errors
  if (status >= 500) {
    Sentry.captureException(err);
    sendCriticalErrorAlert({ error: err, level: 'fatal', context: `apiError:${status}` }).catch((e) => console.error('[api-error] Failed to send critical alert:', e));
  }

  // NEVER expose internal error messages in production
  const publicMessage = isDev ? errMsg : message;

  return NextResponse.json(
    { error: publicMessage },
    { status }
  );
}

/**
 * Safe error handler for catch blocks that previously leaked err.message.
 * Use this as a drop-in replacement for:
// eslint-disable-next-line @typescript-eslint/no-explicit-any
 *   catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
 *
 * Now use:
// eslint-disable-next-line @typescript-eslint/no-explicit-any
 *   catch (err: any) { return apiError(err); }
 */
export function safeApiError(err: unknown) {
  return apiError(err, 'Internal server error', 500);
}

export function notFound(entity = 'Resource') {
  return NextResponse.json({ error: `${entity} not found` }, { status: 404 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function unauthorized(message = 'Authentication required') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'Access denied') {
  return NextResponse.json({ error: message }, { status: 403 });
}
