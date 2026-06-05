interface CacheEntry {
  data: any
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const MAX_ENTRIES = 500
const CLEANUP_BATCH = 100

export async function withCache<T>(
  tenantId: string,
  widgetKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const key = `${tenantId}:${widgetKey}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T
  }
  const data = await fetcher()
  cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 })
  if (cache.size > MAX_ENTRIES) {
    const entries = [...cache.entries()]
      .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)
      .slice(0, CLEANUP_BATCH)
    entries.forEach(([k]) => cache.delete(k))
  }
  return data
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
