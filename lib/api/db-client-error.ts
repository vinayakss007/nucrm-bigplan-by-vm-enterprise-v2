/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * A query failure reaches us wrapped. drizzle's node-postgres driver rethrows as
 * QueryFailedError: the SQL text becomes `message` and the pg error, which is the
 * only object carrying the SQLSTATE in `code`, moves to `cause`. Classifying the
 * top level alone therefore found no code at all — which is why this mapping
 * never fired for any route that ran a real query, including every [id] route in
 * the malformed-uuid class. Walks the cause chain instead of guessing a shape.
 */
function pgErrorOf(err: unknown): { code: string; message: string; constraint?: string } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const e = current as { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === 'string') {
      return {
        code: e.code,
        message: String(e.message ?? ''),
        ...(typeof e.constraint === 'string' ? { constraint: e.constraint } : {}),
      };
    }
    current = e.cause;
  }
  return null;
}

/**
 * Map the Postgres constraint/cast errors that prove out as client problems
 * when a handler let them escape, at the single route chokepoint, instead of
 * a generic 500 (+ Sentry noise for user-input mistakes):
 *
 * - 22P02 uuid cast — ~30 [id] routes have no isEntityId() guard, so probing
 *   /api/tenant/<thing>/foobar used to 500 (Sentry NUCRM-Y/W/X class, #2131).
 *   A bad PATH id -> 404 (not a uuid cannot name an entity); on POST the bad
 *   uuid is almost always a body reference -> 400.
 * - 23505 unique_violation — the roles route already answers 409 for a
 *   duplicate name; unhandled escapes elsewhere get the same status.
 * - 23503 foreign_key_violation — create/update referencing a nonexistent
 *   id is bad client input -> 400.
 * - 23514 check_violation — a CHECK constraint only ever refuses a *value*, and
 *   the value came from the request. Six write surfaces offer vocabulary their
 *   zod schema accepts but the table rejects (invoices.status 'void',
 *   quotes.status 'won', support_tickets.priority 'critical', …), and each one
 *   answered 500 + a Sentry issue + a critical-error page for what is a typo or
 *   a schema/enum drift on our side. The constraint name is what makes the drift
 *   findable, so it goes in the log, not in the client's response.
 *
 * Everything else (including 22P02 on non-uuid types) still propagates so
 * real server bugs keep surfacing as 500s.
 */
export function clientErrorFromDbCode(
  err: unknown,
  method: string,
): { status: number; message: string; constraint?: string } | null {
  const e = pgErrorOf(err);
  if (!e) return null;
  if (e.code === '22P02' && /uuid/i.test(e.message)) {
    return method === 'POST'
      ? { status: 400, message: 'Invalid identifier in request body' }
      : { status: 404, message: 'Not found' };
  }
  if (e.code === '23505') return { status: 409, message: 'Conflict: value already exists' };
  if (e.code === '23503') return { status: 400, message: 'Invalid reference' };
  if (e.code === '23514') {
    return {
      status: 400,
      message: 'Invalid value for a constrained field',
      ...(e.constraint ? { constraint: e.constraint } : {}),
    };
  }
  return null;
}

const methodStorage = new AsyncLocalStorage<string>();

/**
 * Record the HTTP verb for the current request so an error helper that never
 * sees the NextRequest can still pick the right status above. withApiRoute()
 * owns this scope; nothing else needs to set it.
 */
export function runWithHttpMethod<T>(method: string, fn: () => T): T {
  return methodStorage.run(method, fn);
}

/**
 * The verb of the request being handled, or undefined outside a wrapped route
 * (server actions, workers, tests). Callers that must choose a status when this
 * is empty should prefer POST's 400: "invalid identifier" stays true for a bad
 * body or query reference, whereas the GET branch's 404 would tell a client
 * that a write it just attempted had nothing to act on.
 */
export function currentHttpMethod(): string | undefined {
  return methodStorage.getStore();
}

/**
 * For a route that catches its own DB error and answers a literal 500.
 *
 * `withApiRoute()` maps the classifier above for anything that escapes the
 * handler, and `apiError()` maps it for routes that delegate to it — but the
 * remaining write routes end their catch with
 * `return NextResponse.json({ error: 'Failed to create X' }, { status: 500 })`,
 * so a row Postgres refused never reaches either chokepoint. That is what the
 * simulation caught on invoices (`status: 'void'`), quotes (`'won'`) and
 * contracts (`'signed'`): three 500s, a Sentry issue and a critical page for a
 * value the caller could see in the UI, while the equivalent ticket and sequence
 * routes answered 400 because they let the error propagate.
 *
 * Returns the response to send, or null to fall through to the route's own 500
 * so genuine server faults keep failing loudly.
 */
export function clientDbErrorResponse(err: unknown, method?: string): NextResponse | null {
  const mapped = clientErrorFromDbCode(err, method ?? currentHttpMethod() ?? 'POST');
  if (!mapped) return null;
  // A CHECK we wrote ourselves is the one client-error class that is also our
  // bug: it means a form or schema offered a value the table refuses, as the
  // contracts route did with type 'other'. Answering 400 and logging nothing
  // would hide that drift, so name the constraint here (warn, not error — the
  // caller did nothing a server fault should be paged for).
  if (mapped.constraint) {
    logger.warn('[api] check-constraint refusal', {
      constraint: mapped.constraint, status: mapped.status,
    });
  }
  return NextResponse.json({ error: mapped.message }, { status: mapped.status });
}
