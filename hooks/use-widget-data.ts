'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardDataState } from '@/types/dashboard';

interface UseWidgetDataOptions {
  ttl?: number
  enabled?: boolean
}

export function useWidgetData<T = any>(
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

    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        if (Date.now() - timestamp < ttl) {
          setState({ data, loading: false, error: null, stale: false })
          if (!isBackground) return
        }
      }
    } catch { /* Fallback to default on corrupted storage data */ }

    if (abort.signal.aborted) return

    if (!isBackground) {
      setState(prev => ({ ...prev, loading: true }))
    } else {
      setState(prev => ({ ...prev, stale: true }))
    }

    try {
      const res = await fetch(endpoint, { signal: abort.signal, credentials: 'include' })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`HTTP ${res.status}: ${body}`)
      }
      const json = await res.json()
      const payload = json.data ?? json

      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          data: payload, timestamp: Date.now(),
        }))
      } catch { /* Fallback to default on corrupted storage data */ }

      if (!abort.signal.aborted) {
        setState({ data: payload, loading: false, error: null, stale: false })
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
    return () => {
      clearInterval(interval)
      abortRef.current?.abort()
    }
  }, [doFetch, options?.enabled, ttl])

  const refresh = useCallback(() => doFetch(false), [doFetch])

  return { ...state, refresh }
}
