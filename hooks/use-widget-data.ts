/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardDataState } from '@/types/dashboard';

interface UseWidgetDataOptions {
  ttl?: number
  enabled?: boolean
}

/**
 * #1993 — dashboard fan-out coordinator.
 *
 * A dashboard mount runs up to 15 widgets through this hook. Two storms made
 * every mount and every tab-focus hammer the API (each request pins one of
 * the five pooled connections, so they simply queue):
 *
 *   1. Several widgets can point at the SAME endpoint; each used to fire its
 *      own fetch. `inflight` shares one network round-trip per endpoint
 *      between concurrent callers (the shared request is not aborted when one
 *      consumer unmounts — the payload is small, short-lived, and the other
 *      waiters still need it).
 *   2. Every widget registered its OWN visibilitychange listener, so returning
 *      to the tab refetched all 13+ widgets at once. Visibility refresh now
 *      only fires when this widget's cache is actually stale, and each widget
 *      waits a per-instance stagger before checking, spreading the remaining
 *      work over a short window instead of a single thundering herd.
 */
const inflight = new Map<string, Promise<unknown>>()

export function dedupedWidgetFetch(endpoint: string): Promise<unknown> {
  const existing = inflight.get(endpoint)
  if (existing) return existing
  const p = fetch(endpoint, { credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`HTTP ${res.status}: ${body}`)
      }
      const json = await res.json()
      return json.data ?? json
    })
    .finally(() => {
      if (inflight.get(endpoint) === p) inflight.delete(endpoint)
    })
  inflight.set(endpoint, p)
  return p
}

export function useWidgetData<T = unknown>(
  endpoint: string,
  options?: UseWidgetDataOptions
): DashboardDataState<T> & { refresh: () => void } {
  const [state, setState] = useState<DashboardDataState<T>>({
    data: null, loading: true, error: null, stale: false,
  })

  const cacheKey = `dash_widget_${endpoint}`
  const ttl = options?.ttl ?? 300_000
  const abortRef = useRef<AbortController | null>(null)

  const doFetch = useCallback(async (isBackground = false) => {
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    let showedCache = false

    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        if (Date.now() - timestamp < ttl) {
          setState({ data, loading: false, error: null, stale: false })
          showedCache = true
        }
      }
    } catch { /* Fallback to default on corrupted storage data */ }

    if (abort.signal.aborted) return

    if (!isBackground && !showedCache) {
      setState(prev => ({ ...prev, loading: true }))
    } else if (showedCache) {
      setState(prev => ({ ...prev, stale: true }))
    }

    try {
      // #1993: shared round-trip per endpoint instead of one fetch per widget.
      const payload = await dedupedWidgetFetch(endpoint)

      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          data: payload, timestamp: Date.now(),
        }))
      } catch { /* Fallback to default on corrupted storage data */ }

      if (!abort.signal.aborted) {
        setState({ data: payload as T, loading: false, error: null, stale: false })
      }
    } catch (err) {
      if (abort.signal.aborted) return
      if (!isBackground) {
        setState(prev => ({
          ...prev, error: (err as Error).message, loading: false,
        }))
      }
    }
  }, [endpoint, cacheKey, ttl])

  useEffect(() => {
    if (options?.enabled === false) return
    doFetch(false)
    const interval = setInterval(() => doFetch(true), ttl)

    // #1993: returning to the tab must not refetch every widget at once.
    // Each widget waits a short per-instance stagger and skips the fetch
    // entirely when its cached payload is still within TTL.
    const stagger = Math.floor(Math.random() * 1500)
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const t = setTimeout(() => {
        timers.delete(t)
        let fresh = false
        try {
          const cached = sessionStorage.getItem(cacheKey)
          if (cached) {
            const { timestamp } = JSON.parse(cached) as { timestamp: number }
            fresh = Date.now() - timestamp < ttl
          }
        } catch { fresh = false }
        if (!fresh) doFetch(true)
      }, stagger)
      timers.add(t)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const t of timers) clearTimeout(t)
      abortRef.current?.abort()
    }
  }, [doFetch, options?.enabled, ttl, cacheKey])

  const refresh = useCallback(() => doFetch(false), [doFetch])

  return { ...state, refresh }
}
