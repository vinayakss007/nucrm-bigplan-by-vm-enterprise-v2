import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1072: POST /api/setup/create-admin must validate its request body with the
// (previously dead) Zod schema BEFORE performing any DB read/write. These tests
// mock every downstream dependency so an invalid body is rejected with a 400 and
// never reaches the database. A valid body is allowed to flow past validation
// (the existing-super-admin guard then short-circuits with a 403, which is
// enough to prove the body cleared validation without needing a real DB).

const mockCheckRateLimit = vi.fn();
const mockDbSelect = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

// db.select().from().where() resolves to the canned "existing super admin" count.
function makeSelectBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder['from'] = () => builder;
  builder['where'] = () => Promise.resolve(rows);
  return builder;
}

let existingCountRows: unknown[] = [];
const mockDb = {
  select: (...args: unknown[]) => {
    mockDbSelect(...args);
    return makeSelectBuilder(existingCountRows);
  },
  transaction: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/drizzle/schema', () => ({
  users: { isSuperAdmin: 'is_super_admin' },
  tenants: {}, tenantMembers: {}, plans: {}, roles: {},
  onboardingProgress: {}, sessions: {}, pipelines: {}, dealStages: {},
}));
vi.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => a,
  count: () => 'count',
}));
vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn(),
  createToken: vi.fn(),
  hashToken: vi.fn(),
  setSessionCookie: vi.fn(),
  validatePassword: vi.fn(() => null),
}));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn() }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('server-only', () => ({}));

function makeRequest(body: unknown) {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as import('next/server').NextRequest;
}

async function callRoute(body: unknown) {
  const { POST } = await import('@/app/api/setup/create-admin/route');
  const res = await POST(makeRequest(body));
  return { res, json: await res.json() };
}

describe('POST /api/setup/create-admin body validation (#1072)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingCountRows = [{ count: 0 }];
    mockCheckRateLimit.mockResolvedValue(null); // not rate limited
  });

  it('rejects a body with an invalid email and never touches the DB', async () => {
    const { res, json } = await callRoute({
      full_name: 'Admin',
      email: 'not-an-email',
      password: 'longenough123',
      workspace_name: 'Acme',
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    expect(json.details.some((d: { field: string }) => d.field === 'email')).toBe(true);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('rejects a body with a too-short password before any DB access', async () => {
    const { res, json } = await callRoute({
      full_name: 'Admin',
      email: 'admin@example.com',
      password: 'short',
      workspace_name: 'Acme',
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    expect(json.details.some((d: { field: string }) => d.field === 'password')).toBe(true);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('rejects a body missing required fields (no workspace_name / full_name)', async () => {
    const { res, json } = await callRoute({ email: 'admin@example.com', password: 'longenough123' });
    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    const fields = json.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('full_name');
    expect(fields).toContain('workspace_name');
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('lets a valid body clear validation (reaches the existing-super-admin guard)', async () => {
    existingCountRows = [{ count: 1 }]; // a super admin already exists -> 403
    const { res, json } = await callRoute({
      full_name: 'Admin',
      email: 'admin@example.com',
      password: 'longenough123',
      workspace_name: 'Acme',
    });
    // Body passed validation, so the route advanced to the DB guard which 403s.
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
    expect(json.error).toContain('already exists');
  });
});
