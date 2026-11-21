/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Shared client-side fetch → JSON data layer (#2231).
 *
 * Before this existed, list/header UIs called raw `fetch()` + `res.json()`
 * with no `res.ok` check and no try/catch, so:
 *   - a 500 replying `{ "error": "..." }` was read as `{ data: [] }` and
 *     rendered as a FALSE-EMPTY state (0 deals / no results / 0 members),
 *   - an HTML error page made `res.json()` reject, freezing spinners
 *     (`searching` stuck `true`) until a full reload,
 *   - racing per-keystroke fetches let stale responses clobber newer ones.
 *
 * `fetchJsonSafe` gives every consumer ONE contract that separates the three
 * outcomes — success, error, and cancellation — and never throws, so callers
 * can always clear their loading flag and keep prior data on failure.
 */
import { isAbortError } from './view-state';

export type FetchJsonResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'error'; statusCode: number | null; message: string }
  | { status: 'aborted' };

/** Extract a human-readable error message from a JSON error body, if any. */
function messageFromBody(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    // #3408 PR-5B: the canonical failure body is { ok:false, error:{ code,
    // message } }. Read the structured error before the legacy bare string so
    // both shapes surface their message instead of a generic status line.
    const error = record['error'];
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>)['message'];
      if (typeof message === 'string' && message) return message;
    }
    for (const key of ['error', 'message']) {
      if (typeof record[key] === 'string' && record[key]) return record[key] as string;
    }
  }
  return null;
}

/**
 * `fetch` + JSON with an explicit, non-throwing outcome discriminator.
 *
 * - Non-2xx → `{ status: 'error' }` with the server's `error`/`message` when
 *   present, never a silently-swallowed empty body.
 * - Unparseable body (e.g. an HTML gateway page) → also `{ status: 'error' }`.
 * - Network failure → `{ status: 'error', statusCode: null }`.
 * - Abort (newer request superseded this one) → `{ status: 'aborted' }` so
 *   callers can skip state writes instead of rendering stale/racing results.
 */
export async function fetchJsonSafe<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<FetchJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (isAbortError(err)) return { status: 'aborted' };
    return { status: 'error', statusCode: null, message: 'Network error — the request could not be completed.' };
  }
  // Body may hold a JSON error envelope even on non-2xx — try to read it,
  // tolerate HTML/garbage (a 500 page must never reject out of this helper).
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (init.signal?.aborted) return { status: 'aborted' };
  if (!res.ok) {
    return {
      status: 'error',
      statusCode: res.status,
      message: messageFromBody(body) ?? `Request failed with status ${res.status}.`,
    };
  }
  if (body === undefined) {
    return { status: 'error', statusCode: res.status, message: 'The server returned an invalid response.' };
  }
  return { status: 'ok', data: body as T };
}

/**
 * #3408: mutations that must succeed use this instead of ignoring the
 * response. Same parsing/error extraction as fetchJsonSafe, but a refused
 * write throws instead of resolving — so onError fires with the server's
 * message and the UI cannot reload as if the write landed.
 */
export async function fetchJsonOrThrow<T>(url: string, init?: RequestInit): Promise<T> {
  const result = await fetchJsonSafe<T>(url, init);
  if (result.status === 'ok') return result.data;
  throw new Error(result.status === 'aborted' ? 'Request aborted' : result.message);
}
