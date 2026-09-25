/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardDataState } from '@/types/dashboard';
import { fetchWidgetData, onTabVisible } from './widget-fetch-coordinator';

interface UseWidgetDataOptions {
  ttl?: number
  enabled?: boolean
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
  // Strictly-increasing request sequence: a response is only applied if no
  // newer fetch started while it was in flight (replaces the old
  // AbortController, which the shared coordinator makes impossible).
  const seqRef = useRef(0)

  const doFetch = useCallback(async (isBackground = false) => {
    const seq = ++seqRef.current

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

    if (!isBackground && !showedCache) {
      setState(prev => ({ ...prev, loading: true }))
    } else if (showedCache) {
      setState(prev => ({ ...prev, stale: true }))
    }

    try {
      const { json } = await fetchWidgetData(endpoint)
      const payload = (json as { data?: unknown })?.data ?? json

      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          data: payload, timestamp: Date.now(),
        }))
      } catch { /* Fallback to default on corrupted storage data */ }

      if (seq === seqRef.current) {
        setState({ data: payload, loading: false, error: null, stale: false })
      }
    } catch (err) {
      if (seq !== seqRef.current) return
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
    const unsubVisible = onTabVisible(() => doFetch(false))

    return () => {
      clearInterval(interval)
      unsubVisible()
    }
  }, [doFetch, options?.enabled, ttl])

  const refresh = useCallback(() => doFetch(false), [doFetch])

  return { ...state, refresh }
}
