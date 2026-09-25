// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1993 — dashboard widget fan-out coordinator tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { dedupedWidgetFetch, useWidgetData } from '@/hooks/use-widget-data';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

describe('dedupedWidgetFetch (#1993)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shares one network round-trip between concurrent callers of the same endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ data: { n: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      dedupedWidgetFetch('/api/x'),
      dedupedWidgetFetch('/api/x'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
  });

  it('does not dedupe different endpoints and unwraps json.data fallback', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse({ data: 'A' }))
      .mockImplementationOnce(() => jsonResponse({ raw: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(dedupedWidgetFetch('/api/a')).resolves.toBe('A');
    await expect(dedupedWidgetFetch('/api/b')).resolves.toEqual({ raw: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight slot after settling so later calls refetch', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ data: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await dedupedWidgetFetch('/api/y');
    await dedupedWidgetFetch('/api/y');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects with an HTTP error for !ok responses, shared by both waiters', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ error: 'boom' }, false, 500));
    vi.stubGlobal('fetch', fetchMock);
    const p1 = dedupedWidgetFetch('/api/z');
    const p2 = dedupedWidgetFetch('/api/z');
    await expect(p1).rejects.toThrow('HTTP 500');
    await expect(p2).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useWidgetData refetch storm guard (#1993)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    fetchMock = vi.fn().mockImplementation(() => jsonResponse({ data: { v: 'ok' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('initial mount fetches and settles the payload', async () => {
    const { result, unmount } = renderHook(() => useWidgetData<{ v: string }>('/api/w1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ v: 'ok' });
    unmount();
  });

  it('skips the visibility refetch while the cache is still fresh', async () => {
    const { unmount } = renderHook(() => useWidgetData('/api/w2', { ttl: 600_000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    // Simulate tab focus: object stays in sessionStorage, so a fresh-cache
    // widget must NOT refetch even after the stagger window elapses.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const { unmount: unmount2 } = renderHook(() => useWidgetData('/api/w2', { ttl: 600_000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const before = fetchMock.mock.calls.length;

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchMock.mock.calls.length).toBe(before);
    unmount2();
  });

  it('runs the visibility refetch (once) when the cache is stale', async () => {
    const { result, unmount } = renderHook(() => useWidgetData<{ v: string }>('/api/w3', { ttl: 600_000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const before = fetchMock.mock.calls.length;
    expect(before).toBe(1);

    // Age the cached entry beyond the TTL by rewriting its timestamp. A large
    // ttl keeps the periodic interval from firing during the test, so the
    // only extra fetch can come from the visibility handler.
    const cached = JSON.parse(sessionStorage.getItem('dash_widget_/api/w3')!);
    cached.timestamp = Date.now() - 700_000;
    sessionStorage.setItem('dash_widget_/api/w3', JSON.stringify(cached));

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    // Stagger is random in [0, 1500); 3000ms guarantees it fires exactly once.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(result.current.data).toEqual({ v: 'ok' });
    unmount();
  });
});
