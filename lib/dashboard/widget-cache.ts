interface CacheEntry {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
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
  const response = await fetcher()
  const json = await response.clone().json()
  cache.set(key, { data: json, expiresAt: Date.now() + ttlSeconds * 1000 })
  if (cache.size > MAX_ENTRIES) {
    const entries = [...cache.entries()]
      .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)
      .slice(0, CLEANUP_BATCH)
    entries.forEach(([k]) => cache.delete(k))
  }
  return response
}

export function invalidateWidgetCache(tenantId: string, ...widgetKeys: string[]) {
  widgetKeys.forEach(key => cache.delete(`${tenantId}:${key}`))
}

export function getCacheStats() {
  return { size: cache.size, maxEntries: MAX_ENTRIES }
}

export function clearCache() {
  cache.clear()
}
