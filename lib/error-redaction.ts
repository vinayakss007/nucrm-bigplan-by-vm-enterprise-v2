/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Making a database error safe to STORE.
 *
 * drizzle wraps every driver failure in `DrizzleQueryError`, whose message is
 * built as:
 *
 *   `Failed query: ${sql}\nparams: ${params}`
 *
 * (node_modules/drizzle-orm/errors.js). The SQL is parameterised, so the only
 * place the actual values appear is that `params:` tail — and an observer with
 * read access to `error_logs` therefore gets whatever was bound. One
 * `tenant_backup_records.error_message` row in preprod is 82,645 characters, of
 * which the query itself is 300 and the rest is one tenant's exported business
 * data. The same text is copied into `error_logs.message`, `error_logs.stack`,
 * the app log file, Loki and Sentry.
 *
 * The query text and the Postgres SQLSTATE are what diagnose a failure; the
 * bound values are not. So drop the values, keep everything else, and cap the
 * result so no single statement can write an unbounded row.
 *
 * Deliberately NOT applied to client-facing responses — those already go
 * through `safeError`/the API error mapping, which never forwards a DB message.
 */

const QUERY_MARKER = 'Failed query:';
const PARAMS_MARKER = '\nparams:';

/** Ceiling for a stored error message. Real causes are a few hundred chars. */
export const MAX_STORED_MESSAGE = 4_000;
/** Ceiling for a stored stack. ~40 frames, generous for a Next route. */
export const MAX_STORED_STACK = 12_000;

/**
 * Remove the bound-values tail drizzle appends to a failed query.
 *
 * Only rewrites text that carries the `Failed query:` marker, so an unrelated
 * message that happens to contain "params:" is left alone.
 */
export function redactQueryParams(text: string): string {
  if (!text.includes(QUERY_MARKER)) return text;
  const at = text.indexOf(PARAMS_MARKER);
  if (at === -1) return text;
  return `${text.slice(0, at)} [bound parameters redacted — they are tenant data]`;
}

/** Hard cap, with the removed length recorded rather than silently lost. */
export function truncateForStore(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)} [… ${text.length - max} chars omitted]`;
}

/** Message for an unknown thrown value, with parameter values removed. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return redactQueryParams(text);
}

/** Same, for a stack — its first line repeats the message it was thrown with. */
export function errorStackText(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return undefined;
  return redactQueryParams(error.stack);
}

/**
 * A copy of `error` whose message and stack no longer carry bound parameters,
 * for sinks (Sentry) that capture the Error object itself.
 *
 * Returns the original when there was nothing to redact, so the common case
 * keeps its identity — and therefore its Sentry grouping and any `instanceof`
 * expectations at the call site.
 *
 * When a copy IS made: `name` is kept so issue grouping does not change, and
 * `cause` is re-attached to the deepest original cause, because that is the pg
 * error holding the SQLSTATE and its own message is short and parameter-free.
 */
export function redactedErrorForSinks(error: unknown, message: string): unknown {
  if (!(error instanceof Error)) return message;
  const stack = typeof error.stack === 'string' ? error.stack : undefined;
  if (error.message === message && (stack === undefined || redactQueryParams(stack) === stack)) {
    return error;
  }
  const copy = new Error(message);
  copy.name = error.name;
  copy.stack = stack ? redactQueryParams(stack) : copy.stack;
  let deepest: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const next = (deepest as { cause?: unknown }).cause;
    if (!next || next === deepest) break;
    deepest = next;
  }
  if (deepest !== error) copy.cause = deepest;
  return copy;
}
