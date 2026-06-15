export function createMockRedis() {
  const store = new Map<string, { value: string; expires: number }>();
  return {
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      if (item.expires && Date.now() > item.expires) {
        store.delete(key);
        return null;
      }
      return item.value;
    }),
    set: vi.fn(async (key: string, value: string) => { store.set(key, { value, expires: 0 }); return 'OK'; }),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      store.set(key, { value, expires: Date.now() + ttl * 1000 });
      return 'OK';
    }),
    setnx: vi.fn(async (key: string, value: string) => {
      if (store.has(key)) return 0;
      store.set(key, { value, expires: 0 });
      return 1;
    }),
    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
    exists: vi.fn(async (key: string) => store.has(key) ? 1 : 0),
    expire: vi.fn(async (_key: string, _ttl: number) => 1),
    ttl: vi.fn(async (_key: string) => 300),
    incr: vi.fn(async (key: string) => {
      const cur = parseInt(store.get(key)?.value || '0', 10);
      store.set(key, { value: String(cur + 1), expires: 0 });
      return cur + 1;
    }),
    llen: vi.fn(async (_key: string) => 0),
    zcount: vi.fn(async (_key: string, _min: string, _max: string) => 0),
    keys: vi.fn(async (_pattern: string) => []),
    dbsize: vi.fn(async () => store.size),
    info: vi.fn(async () => 'keyspace_hits:100\r\nkeyspace_misses:10\r\nused_memory:1048576\r\nconnected_clients:5\r\nuptime_in_seconds:86400'),
    ping: vi.fn(async () => 'PONG'),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    quit: vi.fn(async () => 'OK'),
    on: vi.fn(),
  };
}

export function createMockDb() {
  return {
    execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    having: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: vi.fn(async (cb: any) => {
      const tx = { execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), insert: vi.fn().mockReturnThis(), values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([]) };
      return cb(tx);
    }),
    query: {
      tenants: { findFirst: vi.fn().mockResolvedValue(null) },
      users: { findFirst: vi.fn().mockResolvedValue(null) },
      sessions: { findFirst: vi.fn().mockResolvedValue(null) },
      tenantModules: { findFirst: vi.fn().mockResolvedValue(null) },
      modules: { findFirst: vi.fn().mockResolvedValue(null) },
      planLimits: { findFirst: vi.fn().mockResolvedValue(null) },
      userUsage: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockRequest(path: string, options?: { method?: string; headers?: Record<string, string>; body?: any }) {
  const url = new URL(path, 'http://localhost:3000');
  return {
    url: url.toString(),
    nextUrl: url,
    method: options?.method || 'GET',
    headers: new Map(Object.entries(options?.headers || {})),
    json: vi.fn().mockResolvedValue(options?.body || {}),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockResponse(data?: any, status = 200) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status, json: vi.fn().mockResolvedValue(data), headers: new Map() } as any;
}
