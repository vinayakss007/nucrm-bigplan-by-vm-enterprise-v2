/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 PR-5B — the ONE HTTP response envelope.
 *
 * `lib/result.ts` gives domain helpers a discriminated `Result<T,E>`. This is
 * its HTTP-boundary twin: every response the API emits is either
 *
 *   success: { ok: true,  data: T }
 *   failure: { ok: false, error: { code, message, details? } }
 *
 * Failure is a value, not a bare `{ error: "string" }` that a client has to
 * guess the meaning of. `code` is a stable machine-readable token; `message`
 * is the safe, human-readable text. The union is closed: `apiOk`/`apiFail` are
 * the only constructors, so a handler cannot assemble a half-shaped response.
 *
 * This module is pure (no next/server import) so the shape can be unit-tested
 * on its own. `withApiRoute` emits `apiFail()` for the errors it synthesizes;
 * handler-owned responses migrate in follow-up PRs — until then the shared
 * client (`failureFromBody`) still recognises the legacy shapes.
 */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailureDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiFailure {
  ok: false;
  error: ApiFailureDetail;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Construct a successful HTTP envelope. */
export function apiOk<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

/** Construct a failed HTTP envelope. `details` is omitted when undefined. */
export function apiFail(code: string, message: string, details?: unknown): ApiFailure {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

export function isApiFailure(value: unknown): value is ApiFailure {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record['ok'] !== false) return false;
  const error = record['error'];
  if (!error || typeof error !== 'object') return false;
  const detail = error as Record<string, unknown>;
  return typeof detail['code'] === 'string' && typeof detail['message'] === 'string';
}

export function isApiSuccess(value: unknown): value is ApiSuccess<unknown> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record['ok'] === true && Object.prototype.hasOwnProperty.call(record, 'data');
}
