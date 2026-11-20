/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 PR-5A — one discriminated result for domain helpers.
 *
 * Failure must be a value the caller has to read. Before this module every
 * helper invented its own shape (`{success}` / `{ok}` / `{status:'error'}` /
 * `{data,error}`), so a returned failure could be dropped without the compiler
 * or a screen noticing — the same class of bug as a discarded `{success:false}`
 * from `sendEmail` (#2998/#3045/#3110). `Result<T,E>` gives those helpers one
 * shape, and `scripts/check-result-consumed.mjs` fails a build when a call
 * result is discarded.
 *
 * The union is deliberately closed: `ok` and `fail` are the only constructors,
 * so no helper can return a half-shaped result that satisfies neither branch.
 */
export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };

/** Construct a successful result. */
export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

/** Construct a failed result. The error is data, not a thrown exception. */
export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; data: T } {
  return result.ok;
}

export function isFail<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

/** Read a value with an explicit fallback — never a silent coercion. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.data : fallback;
}
