import { describe, it, expect, vi, beforeEach } from 'vitest';

// PP-xxx: GET /api/setup/check must count super admins under the platform
// security context (RLS deny-by-default otherwise returns 0 rows on a
// restricted connection, making an existing install look fresh). These tests
// mock every downstream dependency.

const mockCheckRateLimit = vi.fn();
const mockDbSelect = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

function makeSelectBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder['from'] = () => builder;
  builder['where'] = () => Promise.resolve(rows);
  return builder;
}

let existingCountRows: unknown[] = [];
let failSelect = false;
const mockDb = {
  select: (...args: unknown[]) => {
    mockDbSelect(...args);
    if (failSelect) return makeSelectBuilderThatThrows();
    return makeSelectBuilder(existingCountRows);
  },
  execute: vi.fn().mockResolvedValue({ rows: [] }),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(mockDb)),
};

function makeSelectBuilderThatThrows() {
  const builder: Record<string, unknown> = {};
  builder['from'] = () => builder;
  builder['where'] = () => Promise.reject(new Error('rls violation'));
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/db/rls', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/db/rls')>(),
  // exercise the real withSecurityContext, which wraps mockDb.transaction
}));
vi.mock('@/drizzle/schema', () => ({
  users: { isSuperAdmin: 'is_super_admin' },
}));
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...await importOriginal<typeof import('drizzle-orm')>(),
  eq: (...a: unknown[]) => a,
  count: () => 'count',
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('server-only', () => ({}));

function makeRequest() {
  return { headers: new Headers() } as unknown as import('next/server').NextRequest;
}

async function callRoute() {
  const { GET } = await import('@/app/api/setup/check/route');
  const res = await GET(makeRequest());
  return { res, json: await res.json() };
}

describe('GET /api/setup/check super-admin detection under RLS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingCountRows = [{ count: 0 }];
    failSelect = false;
    mockCheckRateLimit.mockResolvedValue(null);
  });

  it('reports setup_done: false on a fresh install (zero super admins)', async () => {
    const { res, json } = await callRoute();
    expect(res.status).toBe(200);
    expect(json).toEqual({ setup_done: false });
  });

  it('reports setup_done: true when a super admin already exists', async () => {
    existingCountRows = [{ count: 1 }];
    const { res, json } = await callRoute();
    expect(res.status).toBe(200);
    expect(json).toEqual({ setup_done: true });
  });

  it('returns 503 when the DB read fails instead of claiming setup is open', async () => {
    failSelect = true;
    const { res, json } = await callRoute();
    expect(res.status).toBe(503);
    expect(json.error).toBe('Service unavailable');
  });

  it('short-circuits with the rate-limit response before any DB access', async () => {
    const limited = Response.json({ error: 'Too many requests' }, { status: 429 });
    mockCheckRateLimit.mockResolvedValue(limited);
    const { res } = await callRoute();
    expect(res.status).toBe(429);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
