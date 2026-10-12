/**
 * Issue #2225 (HIGH) — PUT /api/admin/tenant-restore must take a per-tenant
 * advisory lock BEFORE starting a restore: concurrent restores for the same
 * tenant fail fast with 409 (no interleaved wipe+import), and the lock is
 * released when the background restore finishes — success or failure.
 *
 * Mock pattern follows tests/unit/public-tickets.test.ts (thenable db chains,
 * module-level vi.mock before dynamic route import).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  mockRequireAuth,
  mockAcquireLock,
  mockReleaseLock,
  mockRestore,
  mockInsertReturning,
  mockUpdateWhere,
  mockSet,
  dbMocks,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockRequireAuth = { current: null as any, fn: null as any };
  const mockAcquireLock = vi.fn();
  const mockReleaseLock = vi.fn();
  const mockRestore = vi.fn();
  const mockInsertReturning = vi.fn();
  const mockUpdateWhere = vi.fn();
  const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const dbMocks = {
    findBackup: vi.fn(),
    findTenant: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  return { mockRequireAuth, mockAcquireLock, mockReleaseLock, mockRestore, mockInsertReturning, mockUpdateWhere, mockSet, dbMocks };
});

vi.mock('@/lib/api/with-api-route', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withApiRoute: (handler: any) => handler,
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => mockRequireAuth.current),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { apiError: (err: any) => NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 }) };
});

vi.mock('@/lib/api/validate', async () => {
  const { NextResponse } = await import('next/server');
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readJsonBody: async (req: any) => req.json(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validateBody: (schema: any, body: unknown) => {
      try {
        return { data: schema.parse(body) };
      } catch {
        return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
      }
    },
  };
});

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      tenantBackupRecords: { findFirst: dbMocks.findBackup, findMany: vi.fn() },
      tenants: { findFirst: dbMocks.findTenant },
      tenantRestoreRecords: { findFirst: vi.fn(), findMany: vi.fn() },
    },
    insert: dbMocks.insert.mockReturnValue({
      values: vi.fn(() => ({ returning: mockInsertReturning })),
    }),
    update: dbMocks.update.mockReturnValue({
      set: vi.fn(() => ({ where: mockUpdateWhere })),
    }),
    select: vi.fn(),
  },
}));

vi.mock('@/lib/tenant-restore-lock', () => ({
  acquireTenantRestoreLock: mockAcquireLock,
  releaseTenantRestoreLock: mockReleaseLock,
  tenantRestoreLockId: (tenantId: string) => tenantId.length,
  TenantRestoreConflictError: class TenantRestoreConflictError extends Error {},
}));

vi.mock('@/lib/tenant-data-import', () => ({
  TenantDataImporter: class TenantDataImporter {
    restore = mockRestore;
  },
}));

vi.mock('@/lib/tenant-data-export', () => ({
  TenantDataExporter: class TenantDataExporter {},
}));

const BACKUP = {
  id: 'backup-1',
  tenantId: 'tenant-1',
  status: 'completed',
  backupData: { contacts: { columns: ['id'], rows: [{ id: '1' }] } },
};
const TENANT = { id: 'tenant-1', name: 'Acme', slug: 'acme' };

function putRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/tenant-restore', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** Let the fire-and-forget background restore chain fully drain. */
async function flushBackground() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

describe('PUT /api/admin/tenant-restore — per-tenant restore lock (#2225)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.current = { isSuperAdmin: true, userId: 'admin-1' };
    dbMocks.findBackup.mockResolvedValue(BACKUP);
    dbMocks.findTenant.mockResolvedValue(TENANT);
    dbMocks.insert.mockReturnValue({ values: () => ({ returning: mockInsertReturning }) });
    dbMocks.update.mockReturnValue({ set: mockSet });
    mockInsertReturning.mockResolvedValue([{ id: 'restore-1' }]);
    mockUpdateWhere.mockResolvedValue(undefined);
    mockAcquireLock.mockResolvedValue({ client: { release: vi.fn() }, lockId: 123 });
    mockReleaseLock.mockResolvedValue(undefined);
    mockRestore.mockResolvedValue({ tablesRestored: 1, recordsRestored: 1, errors: [] });
  });

  it('returns 409 and starts nothing when another restore holds the tenant lock', async () => {
    mockAcquireLock.mockResolvedValue(null);
    const { PUT } = await import('@/app/api/admin/tenant-restore/route');

    const res = await PUT(putRequest({ backupId: 'backup-1', confirmRestore: true, restoreOptions: { deleteExisting: true } }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('restore_in_progress');
    // Fail-fast: no restore record, no wipe+import started.
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockAcquireLock).toHaveBeenCalledWith('tenant-1');
  });

  it('starts the restore under the lock and releases it when the atomic wipe+import completes', async () => {
    const { PUT } = await import('@/app/api/admin/tenant-restore/route');
    const lock = { client: { release: vi.fn() }, lockId: 123 };
    mockAcquireLock.mockResolvedValue(lock);

    const res = await PUT(putRequest({ backupId: 'backup-1', confirmRestore: true, restoreOptions: { deleteExisting: true } }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.restoreId).toBe('restore-1');

    // The background restore uses the SINGLE-transaction importer.restore
    // (wipe + import atomic), not the old deleteExistingData/importAll pair.
    await flushBackground();
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockRestore.mock.calls[0]?.[1]).toMatchObject({ deleteExisting: true });
    expect(mockReleaseLock).toHaveBeenCalledWith(lock);
  });

  it('still releases the lock when the atomic import fails, and marks the restore failed honestly', async () => {
    const { PUT } = await import('@/app/api/admin/tenant-restore/route');
    const lock = { client: { release: vi.fn() }, lockId: 123 };
    mockAcquireLock.mockResolvedValue(lock);
    mockRestore.mockRejectedValue(new Error('Import failed: rollback of wipe+import transaction'));

    const res = await PUT(putRequest({ backupId: 'backup-1', confirmRestore: true }));
    expect(res.status).toBe(200);

    await flushBackground();
    // Honest failure reporting: record marked failed with the real reason…
    type SetArgs = { status?: string; errorMessage?: string };
    const failedSet = mockSet.mock.calls
      .map((c: unknown[]) => c[0] as SetArgs)
      .find((args: SetArgs) => args?.status === 'failed');
    expect(failedSet).toMatchObject({ status: 'failed' });
    expect(failedSet?.errorMessage).toContain('Import failed');
    // …and the tenant lock is handed back (finally), so the next restore can go.
    expect(mockReleaseLock).toHaveBeenCalledWith(lock);
  });

  it('releases the lock when the restore record cannot be created (no leaked lock)', async () => {
    const { PUT } = await import('@/app/api/admin/tenant-restore/route');
    const lock = { client: { release: vi.fn() }, lockId: 123 };
    mockAcquireLock.mockResolvedValue(lock);
    mockInsertReturning.mockResolvedValue([]); // no row returned → performTenantRestore throws

    const res = await PUT(putRequest({ backupId: 'backup-1', confirmRestore: true }));
    expect(res.status).toBe(500);

    expect(mockReleaseLock).toHaveBeenCalledWith(lock);
    await flushBackground();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('rejects non-super-admins before touching the lock', async () => {
    mockRequireAuth.current = { isSuperAdmin: false, userId: 'u2' };
    const { PUT } = await import('@/app/api/admin/tenant-restore/route');

    const res = await PUT(putRequest({ backupId: 'backup-1', confirmRestore: true }));
    expect(res.status).toBe(403);
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });
});
