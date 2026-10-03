/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Pure view-state derivation for #2231.
 *
 * The bug class this prevents: components kept ONE boolean (`isEmpty`) for
 * both "server said no rows" and "the request failed", so an API error
 * rendered as a false-empty state ("No results", "0 active members",
 * "0 deals / $0"), or a rejected `res.json()` left a spinner stuck `true`.
 *
 * `deriveViewState` makes loading / error / empty / data four distinct,
 * mutually exclusive outcomes. Render branches must consume it (or the
 * equivalent discriminator from `lib/fetch-json`) instead of collapsing
 * error into empty.
 */

export type ViewState = 'loading' | 'error' | 'empty' | 'data';

export interface ViewStateInput<T> {
  /** A request is currently in flight for this view. */
  isLoading: boolean;
  /** The most recent attempt for this view failed (network, non-2xx, bad body). */
  isError: boolean;
  /**
   * The last successfully loaded rows. `null`/`undefined` means "nothing has
   * ever loaded successfully"; an empty array means the server genuinely
   * returned zero rows — the two must render differently only after an error,
   * never by accident.
   */
  data: readonly T[] | null | undefined;
}

/**
 * Resolution order (first match wins):
 *  1. `error`    — never let a failure masquerade as "no results" and never
 *                  let a stuck `isLoading` flag hide an error (frozen spinner).
 *  2. `loading`  — only while there is nothing on screen to keep showing;
 *                  a background reload with existing data does NOT blank it.
 *  3. `empty`    — a genuine zero-row success.
 *  4. `data`     — rows to render.
 */
export function deriveViewState<T>({ isLoading, isError, data }: ViewStateInput<T>): ViewState {
  if (isError) return 'error';
  if (isLoading && !data) return 'loading';
  if (!data || data.length === 0) return 'empty';
  return 'data';
}

/** True when `err` is the rejection an `AbortController` produces (fetch, DOMException, or plain Error). */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'name' in err && (err as { name?: unknown }).name === 'AbortError'
  );
}
