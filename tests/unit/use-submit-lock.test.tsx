// @vitest-environment jsdom
// Unit tests for the #2230 shared submit lock (hooks/use-submit-lock.ts).
// These cover the exact failure modes from the issue: double-click firing two
// POSTs, and a network/502 failure leaving the dialog wedged with no feedback.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useSubmitLock } from '@/hooks/use-submit-lock';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const toastError = vi.mocked(toast.error);

describe('useSubmitLock (#2230)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a second run() while a task is in flight — the request fires once', async () => {
    let release!: () => void;
    const handler = vi.fn(() => new Promise<void>((res) => { release = res; }));
    const { result } = renderHook(() => useSubmitLock(handler));

    let p1!: Promise<void | undefined>;
    let p2!: Promise<void | undefined>;
    act(() => { p1 = result.current.run(); p2 = result.current.run(); });

    expect(handler).toHaveBeenCalledTimes(1); // belt-and-braces: second click dropped
    expect(result.current.isPending).toBe(true);

    await act(async () => { release(); await Promise.all([p1, p2]); });
    expect(result.current.isPending).toBe(false);
  });

  it('double-click on a fetch-backed handler POSTs exactly once', async () => {
    let releaseFetch!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn(() => new Promise<{ ok: boolean }>((res) => { releaseFetch = res; }));
    vi.stubGlobal('fetch', fetchMock);

    const pending: Promise<unknown>[] = [];
    const { result } = renderHook(() => useSubmitLock(async () => {
      const res = await fetch('/api/tenant/invoices', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to create invoice');
    }));

    act(() => { pending.push(result.current.run(), result.current.run()); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(true);

    await act(async () => { releaseFetch({ ok: true }); await Promise.all(pending); });
    expect(result.current.isPending).toBe(false);
  });

  it('failed request surfaces the error via toast.error and unlocks the button', async () => {
    const task = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Failed to create deal'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSubmitLock(task));

    await act(async () => { await result.current.run(); });
    expect(toastError).toHaveBeenCalledWith('Failed to create deal');
    expect(result.current.isPending).toBe(false);

    // unlocked: a retry goes through and no additional error toast is shown
    await act(async () => { await result.current.run(); });
    expect(task).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
  });

  it('HTML-502 style crash (fetch rejects with TypeError) still gives feedback and unlocks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useSubmitLock(async () => {
      const res = await fetch('/api/tenant/deals/bulk', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk action failed');
    }));

    let out: unknown;
    await act(async () => { out = await result.current.run(); });
    expect(out).toBeUndefined();
    expect(toastError).toHaveBeenCalledWith('Failed to fetch');
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('non-Error rejection falls back to the default (or custom) message', async () => {
    const { result } = renderHook(() => useSubmitLock(
      async () => { throw 'boom'; },
      'Something went wrong. Please try again.',
    ));
    await act(async () => { await result.current.run(); });
    expect(toastError).toHaveBeenCalledWith('Something went wrong. Please try again.');
    expect(result.current.isPending).toBe(false);
  });

  it('resolves with the task result on success and undefined when dropped', async () => {
    const { result } = renderHook(() => useSubmitLock(async (n: number) => {
      await Promise.resolve();
      return { affected: n };
    }));

    let first!: unknown;
    let second!: unknown;
    act(() => { first = result.current.run(1); second = result.current.run(2); });
    first = await (first as Promise<unknown>);
    second = await (second as Promise<unknown>);
    expect(first).toEqual({ affected: 1 });
    expect(second).toBeUndefined();
  });
});
