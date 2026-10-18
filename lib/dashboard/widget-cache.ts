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
  fetcher: () => Promise<Response>,
  // #2688 — the entry was keyed by tenant and widget, so whatever the first
  // caller of a TTL window computed was served to everyone else in that tenant
  // for up to 300s. Routes whose read is per-caller pass `ownerCacheKey(...)`;
  // 'tenant' keeps the shared entry for reads that genuinely are tenant-wide.
  scopeKey = 'tenant'
): Promise<Response> {
  const key = `${tenantId}:${widgetKey}:${scopeKey}`
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
  // A write invalidates every caller's entry for the widget, not just the
  // writer's: the scope suffix (#2688) means one widget now has N keys, and a
  // deal reassigned away from me must disappear from my tile as surely as the
  // manager's whole-tenant tile must.
  const prefixes = keys.map(key => `${tenantId}:${key}:`)
  for (const cached of [...cache.keys()]) {
    if (prefixes.some(prefix => cached.startsWith(prefix))) cache.delete(cached)
  }
}

export function getCacheStats() {
  return { size: cache.size, maxEntries: MAX_ENTRIES }
}

export function clearCache() {
  cache.clear()
  pending.clear()
}
