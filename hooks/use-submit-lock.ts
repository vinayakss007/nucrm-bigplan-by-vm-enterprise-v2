/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';

/**
 * In-flight submit lock for dialog forms and bulk actions (#2230).
 *
 * High-tenant write handlers used to fire a second POST on double-click and,
 * when a fetch/`res.json()` threw (network error, HTML 502), left the dialog
 * wedged at "Creating…" with zero user feedback. This hook gives every such
 * handler the same three guarantees:
 *
 *  1. Re-entrancy lock — while a task is in flight, extra `run()` calls are
 *     dropped (belt); pair `isPending` with `disabled` on the button (braces).
 *  2. Feedback — any rejection thrown by the task is surfaced via
 *     `toast.error(err.message)` (or a fallback for non-Error throws).
 *  3. No stuck pending state — the flag is cleared in `finally`, so a failed
 *     request always re-enables the submit button.
 *
 * `run()` resolves to the task's return value on success, or `undefined` when
 * the call was dropped (already in flight) or failed — so callers can gate
 * success side-effects with `if (data) { … }`.
 */
export function useSubmitLock<Args extends unknown[], R = void>(
  task: (...args: Args) => Promise<R>,
  fallbackErrorMessage = 'Something went wrong. Please try again.',
) {
  const pendingRef = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const taskRef = useRef(task);
  taskRef.current = task;

  const run = useCallback(async (...args: Args): Promise<R | undefined> => {
    if (pendingRef.current) return undefined; // second click mid-flight — drop it
    pendingRef.current = true;
    setIsPending(true);
    try {
      return await taskRef.current(...args);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : fallbackErrorMessage);
      return undefined;
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }, [fallbackErrorMessage]);

  return { isPending, run };
}
