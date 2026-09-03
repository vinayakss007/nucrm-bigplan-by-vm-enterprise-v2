/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { WIDGET_REGISTRY } from '@/components/tenant/dashboard/widget-registry'

interface CacheEntry {
  data: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<Response>>()
const MAX_ENTRIES = 500
const CLEANUP_BATCH = 100

export async function withCache(
  tenantId: string,
  widgetKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<Response>
): Promise<Response> {
  const key = `${tenantId}:${widgetKey}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(JSON.stringify(cached.data), {
      headers: { 'content-type': 'application/json' },
    })
  }

  cache.delete(key)

  const inflight = pending.get(key)
  if (inflight) return inflight.then(r => r.clone())

  const promise = fetcher()
    .then(async response => {
      const json = await response.clone().json()
      cache.set(key, { data: json, expiresAt: Date.now() + ttlSeconds * 1000 })
      if (cache.size > MAX_ENTRIES) {
        const entries = [...cache.entries()]
          .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)
          .slice(0, CLEANUP_BATCH)
        entries.forEach(([k]) => cache.delete(k))
      }
      pending.delete(key)
      return response
    })
    .catch(err => {
      pending.delete(key)
      throw err
    })

  pending.set(key, promise)
  return promise
}

export function invalidateWidgetCache(tenantId: string, ...widgetKeys: string[]) {
  const keys = widgetKeys.length ? widgetKeys : Object.keys(WIDGET_REGISTRY)
  keys.forEach(key => cache.delete(`${tenantId}:${key}`))
}

export function getCacheStats() {
  return { size: cache.size, maxEntries: MAX_ENTRIES }
}

export function clearCache() {
  cache.clear()
  pending.clear()
}
