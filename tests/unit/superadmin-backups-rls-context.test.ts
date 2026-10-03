import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * PP-031. The backups console queried through the plain `db` handle, which sets
 * no `app.is_super_admin`, so `backup_schedules` reads and `backup_records`
 * writes matched zero rows and answered 200/404 as if the data did not exist.
 *
 * Setting the context per super-admin-gated branch creates two properties a
 * status code cannot show, and they are the ones a later edit is most likely to
 * break:
 *  - the context must be established on the branch that needs it, or that branch
 *    stays exactly as blind as it was;
 *  - it must NEVER be established for a non-super-admin. `?list=recent`
 *    deliberately serves tenant users through a metadata filter, and handing
 *    them the GUC would let RLS stop enforcing the isolation the filter exists
 *    to provide.
 * Also pins the restore POST's confirmation gate, since the read it guards ends
 * in `pg_restore --clean` over live data.
 */

const mockCtx = { userId: 'admin-1', tenantId: 't-1', isSuperAdmin: true, user: { email: 'admin@x.test' } };
const mockRequireAuth = vi.fn();
const mockSetSuperAdminContext = vi.fn();
const mockAudit = vi.fn();
const mockRateLimit = vi.fn();
const mockCreateBackup = vi.fn();
const mockConcurrencyGuard = vi.fn();
const mockCheckFileExists = vi.fn();

let rows: Record<string, unknown>[] = [];
const joinConditions: unknown[] = [];
const callOrder: string[] = [];

function makeChain<T>(resolveValue: T) {
  const chain: Record<string, unknown> = {};
  const self = new Promise<T>((res) => res(resolveValue));
  chain.from = () => chain;
  chain.leftJoin = (_table: unknown, on: unknown) => { joinConditions.push(on); return chain; };
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  chain.limit = () => chain;
  chain.set = () => chain;
  chain.returning = () => self;
  chain.catch = (onRejected: (e: unknown) => unknown) => self.catch(onRejected);
  return Object.assign(chain, {
    then: (onFulfilled: (v: T) => unknown, onRejected: (e: unknown) => unknown) =>
      self.then(onFulfilled, onRejected),
  });
}

const mockDb = {
  // Each select gets its OWN row objects. The critical branch assigns one query's
  // result onto another's (`stats.by_table = tableStats`), so sharing one array
  // identity across calls would make the response literally circular and the
  // handler would 500 for a reason that has nothing to do with what is under test.
  select: vi.fn(() => { callOrder.push('query'); return makeChain(rows.map((r) => ({ ...r }))); }),
  update: vi.fn(() => { callOrder.push('query'); return makeChain(rows.map((r) => ({ ...r }))); }),
  insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(rows)) })),
  execute: vi.fn(() => Promise.resolve({ rows: [] })),
};

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: (...a: unknown[]) => mockRequireAuth(...a) }));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(fn: T) => fn }));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: (...a: unknown[]) => mockAudit(...a) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/db/rls', () => ({
  setSuperAdminContext: async () => { mockSetSuperAdminContext(); callOrder.push('context'); },
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: (...a: unknown[]) => mockRateLimit(...a) }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: (...a: unknown[]) => mockConcurrencyGuard(...a) }));
vi.mock('@/lib/backups/backup-service', () => ({
  createBackup: (...a: unknown[]) => mockCreateBackup(...a),
  BackupConfigurationError: class extends Error { statusCode = 503; },
}));
vi.mock('@/lib/restore/runtime-fs', () => ({
  downloadFromS3: vi.fn(),
  checkFileExists: (...a: unknown[]) => mockCheckFileExists(...a),
  deleteFile: vi.fn(async () => {}),
}));

const backupsRoute = await import('@/app/api/superadmin/backups/route');
const itemRoute = await import('@/app/api/superadmin/backups/[id]/route');
const restoreRoute = await import('@/app/api/superadmin/restore/route');

type Req = import('next/server').NextRequest;
const req = (path: string, body?: unknown): Req =>
  ({ url: `http://localhost${path}`, method: body === undefined ? 'GET' : 'POST', json: async () => body }) as unknown as Req;
const PARAMS = (id: string) => ({ params: Promise.resolve({ id }) });
const contextBeforeQuery = () =>
  callOrder.indexOf('context') !== -1 && callOrder.indexOf('context') < callOrder.indexOf('query');

beforeEach(() => {
  vi.clearAllMocks();
  rows = [{ id: 'b1', status: 'completed', storagePath: 'backups/d.sql', storageType: 'local' }];
  joinConditions.length = 0;
  callOrder.length = 0;
  mockRequireAuth.mockResolvedValue(mockCtx);
  mockRateLimit.mockResolvedValue(undefined);
  mockConcurrencyGuard.mockResolvedValue(undefined);
  mockCreateBackup.mockResolvedValue({ id: 'b1', metadata: {} });
  mockCheckFileExists.mockResolvedValue(false);
});

describe('GET /api/superadmin/backups?list=recent', () => {
  it('establishes the platform context for a super admin, before the query', async () => {
    const res = await backupsRoute.GET(req('/api/superadmin/backups?list=recent'));
    expect(res.status).toBe(200);
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
    expect(contextBeforeQuery()).toBe(true);
  });

  it('never establishes it for a tenant user, whose branch is metadata-filtered', async () => {
    mockRequireAuth.mockResolvedValue({ ...mockCtx, isSuperAdmin: false });
    const res = await backupsRoute.GET(req('/api/superadmin/backups?list=recent'));
    expect(res.status).toBe(200);
    expect(mockSetSuperAdminContext).not.toHaveBeenCalled();
  });

  it('compares the tenant join as text, so metadata cannot make the query 42883', async () => {
    // PP-031b: `tenants.id = metadata->>'tenant_id'` was uuid = text. Postgres
    // rejected every request and the branch's .catch(() => []) turned that into
    // an empty 200, so the page could not tell a broken query from no backups.
    await backupsRoute.GET(req('/api/superadmin/backups?list=recent'));
    // Rendered through the real Postgres dialect: this is the string that would
    // reach the server, so the cast has to be visible in it, not just in the
    // Drizzle expression tree.
    const rendered = joinConditions
      .map((on) => new PgDialect().sqlToQuery(on as never).sql)
      .join('\n');
    expect(rendered).toContain('::text');
    expect(rendered).toContain('tenant_id');
  });
});

describe('GET /api/superadmin/backups (schedules, critical)', () => {
  it('schedules branch sets the context; backup_schedules is RLS-guarded', async () => {
    const res = await backupsRoute.GET(req('/api/superadmin/backups'));
    expect(res.status).toBe(200);
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
    expect(contextBeforeQuery()).toBe(true);
  });

  it('refuses a non super admin without touching the context', async () => {
    mockRequireAuth.mockResolvedValue({ ...mockCtx, isSuperAdmin: false });
    const res = await backupsRoute.GET(req('/api/superadmin/backups'));
    expect(res.status).toBe(403);
    expect(mockSetSuperAdminContext).not.toHaveBeenCalled();
  });

  it('critical branch sets the context too', async () => {
    const res = await backupsRoute.GET(req('/api/superadmin/backups?critical=true'));
    expect(res.status).toBe(200);
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/superadmin/backups', () => {
  it('sets the context before the concurrency guard reads the schedule', async () => {
    const res = await backupsRoute.PATCH(req('/api/superadmin/backups', { id: 's1', enabled: false }));
    expect(res.status).toBe(200);
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
    expect(contextBeforeQuery()).toBe(true);
  });
});

describe('POST /api/superadmin/backups', () => {
  it('sets the context so the tenant_id metadata write can match the row', async () => {
    // createBackupSchema requires z.string().uuid(), so a readable id here would
    // be rejected by validation long before the RLS question is reached.
    const res = await backupsRoute.POST(
      req('/api/superadmin/backups', {
        backup_type: 'full',
        tenant_id: '3f2b7c1d-9a4e-4f6b-8d2c-1e5a7b9c0d21',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/superadmin/backups/[id]', () => {
  it('sets the context, or the soft delete matches nothing and 404s a live row', async () => {
    const res = await itemRoute.DELETE(req('/api/superadmin/backups/b1'), PARAMS('b1'));
    expect(res.status).toBe(200);
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
    expect(contextBeforeQuery()).toBe(true);
  });

  it('does not set it for a non super admin', async () => {
    mockRequireAuth.mockResolvedValue({ ...mockCtx, isSuperAdmin: false });
    const res = await itemRoute.DELETE(req('/api/superadmin/backups/b1'), PARAMS('b1'));
    expect(res.status).toBe(403);
    expect(mockSetSuperAdminContext).not.toHaveBeenCalled();
  });

  it('GET sets it for the detail view', async () => {
    const res = await itemRoute.GET(req('/api/superadmin/backups/b1'), PARAMS('b1'));
    expect(res.status).toBe(200);
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/superadmin/restore', () => {
  const body = (confirm: boolean) => ({ backup_id: 'b1', confirm_restore: confirm });

  it('refuses an unconfirmed restore before establishing any privileged read', async () => {
    const res = await restoreRoute.POST(req('/api/superadmin/restore', body(false)));
    expect(res.status).toBe(400);
    expect(mockSetSuperAdminContext).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('confirm_restore') });
  });

  it('proceeds to the lookup once confirmed', async () => {
    // restoreSchema used to accept confirm_restore: false and the handler
    // discarded the value, so repairing the RLS-blind read alone would have
    // turned this into an unconfirmed pg_restore --clean over live data.
    const res = await restoreRoute.POST(req('/api/superadmin/restore', body(true)));
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(404); // checkFileExists mocked false
  });

  it('rejects a malformed body before any privileged read', async () => {
    const res = await restoreRoute.POST(req('/api/superadmin/restore', { backup_id: '' }));
    expect(res.status).toBe(400);
    expect(mockSetSuperAdminContext).not.toHaveBeenCalled();
  });

  it('GET sets the context so the Restore dropdown can list completed archives', async () => {
    const res = await restoreRoute.GET(req('/api/superadmin/restore'));
    expect(res.status).toBe(200);
    expect(mockSetSuperAdminContext).toHaveBeenCalledTimes(1);
  });
});
