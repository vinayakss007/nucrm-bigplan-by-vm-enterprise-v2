/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { logError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { sendCriticalErrorAlert } from '@/lib/critical-error-alert';
import { InvalidJsonBodyError } from '@/lib/api/validate';
import { ConcurrencyError, InvalidExpectedUpdatedAtError } from '@/lib/concurrency';
import { clientErrorFromDbCode, currentHttpMethod } from '@/lib/api/db-client-error';

/**
 * @deprecated Use `handleError()` from `@/lib/errors` for new code.
 * The canonical server-side error handling lives in `lib/errors.ts` with the
 * `AppError` class hierarchy (`AuthError`, `NotFoundError`, `ValidationError`, etc.).
 *
 * This file remains functional and safe to use in existing routes during the
 * migration period, but all new API routes should prefer:
 *
 *   import { handleError } from '@/lib/errors';
 *   catch (err) { return handleError(err); }
 *
 * --- Legacy docs below ---
 *
 * Centralized API error handler.
 *
 * SECURITY: Never exposes internal error messages in production.
 * In development, includes the real message for debugging.
 * Always reports 5xx errors to Sentry.
 *
 * Usage:
 *   } catch (err: any) { return apiError(err); }
 */
export function apiError(err: unknown, message = 'Internal server error', status = 500) {
  const isDev = process.env.NODE_ENV === 'development';
  const errMsg = err instanceof Error ? err.message : String(err);

  // Postgres raised a client-input error (bad uuid in the path, duplicate key,
  // dangling reference). withApiRoute maps these for errors that escape the
  // handler, but most routes catch their own DB errors and land here first, so
  // without this branch ~90 [id] endpoints answered 500, filed a Sentry issue
  // and paged an operator for what the caller mistyped. Same classifier as the
  // wrapper, so the two paths cannot disagree. Computed before the log line so
  // that reports the status actually returned, not the caller's hardcoded 500.
  const dbClientError = clientErrorFromDbCode(err, currentHttpMethod() ?? 'POST');

  // Structured log line for every apiError call. PII-safe by design: only the
  // message and the first stack frame are recorded — never full stacks, bodies
  // or request payloads. lib/logger does not import this module, so there is no
  // recursion path.
  const stackTopLine = err instanceof Error && typeof err.stack === 'string'
    ? err.stack.split('\n')[1]?.trim()
    : undefined;
  logger.error('[api]', {
    status: dbClientError?.status ?? status,
    message: errMsg,
    // Which constraint refused the row is the difference between "the caller
    // mistyped" and "our enum and the table's CHECK disagree" — the latter is
    // invisible in the SQL text, which drizzle has already flattened to $n.
    ...(dbClientError?.constraint ? { constraint: dbClientError.constraint } : {}),
    ...(stackTopLine ? { stack: stackTopLine } : {}),
  });

  // A malformed request body is the caller's fault, not a server fault. Routes
  // parse with readJsonBody() which raises this tagged error, so we can answer
  // 400 without guessing — and without paging anyone, since there is nothing
  // for an operator to fix. Checked before `status` is honoured because callers
  // pass a hardcoded 500 from their catch block.
  if (err instanceof InvalidJsonBodyError) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // A lost-update conflict is an expected outcome of two people saving the same
  // record, not a fault. withConcurrencyGuard() throws this when the compare-and-swap
  // on updatedAt matched no rows. Without this branch it fell through to the 500
  // default: the client got "Internal server error" with no way to tell "refresh and
  // retry" from "the server is broken", Sentry recorded an exception, and
  // sendCriticalErrorAlert paged someone -- every time a user double-clicked Save.
  // The error already carries statusCode 409; nothing was reading it.
  if (err instanceof ConcurrencyError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode });
  }

  // A caller opted into the optimistic-concurrency check with a missing or
  // unparseable expectedUpdatedAt. That is a bad request (the client's fault),
  // not a server fault, so answer 400 without paging anyone.
  if (err instanceof InvalidExpectedUpdatedAtError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode });
  }

  if (dbClientError) {
    return NextResponse.json({ error: dbClientError.message }, { status: dbClientError.status });
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
 *   catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
 *
 * Now use:
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
