import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * components/superadmin/backups-data-table.tsx has always rendered a Download
 * and a Delete button that fetch /api/superadmin/backups/[id]/download and
 * /api/superadmin/backups/[id]. Neither route existed, so both clicks 404'd —
 * and the download handler toasted "Download started" before sending anything,
 * so the console reported success for a request that could not succeed.
 *
 * What the replacement routes must not get wrong:
 *  - Delete is SOFT. It stamps deleted_at/deleted_by and leaves the archive in
 *    object storage; reclaiming bytes is deleteOldBackups()'s job.
 *  - A volume-local backup (storage_type 'local') has no URL to sign, so it is
 *    refused loudly instead of redirected to a key the storage layer 404s on.
 */

const mockCtx = { userId: 'admin-1', isSuperAdmin: true, user: { email: 'admin@x.test' } };
const mockRequireAuth = vi.fn();
const mockGetSignedUrl = vi.fn();
const mockAudit = vi.fn();

let selectRows: unknown[] = [];
let updateRows: unknown[] = [];
let lastSetArg: Record<string, unknown> = {};

function makeChain<T>(resolveValue: T) {
  const chain: Record<string, unknown> = {};
  const self = new Promise<T>((res) => res(resolveValue));
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.set = (arg: Record<string, unknown>) => { lastSetArg = arg; return chain; };
  chain.returning = () => Promise.resolve(resolveValue);
  return Object.assign(chain, {
    then: (onFulfilled: (v: T) => unknown, onRejected: (e: unknown) => unknown) =>
      self.then(onFulfilled, onRejected),
  });
}

const mockDb = {
  select: vi.fn(() => makeChain(selectRows)),
  update: vi.fn(() => makeChain(updateRows)),
};

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: (...a: unknown[]) => mockRequireAuth(...a) }));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(fn: T) => fn }));
vi.mock('@/lib/storage/s3', () => ({ getSignedUrl: (...a: unknown[]) => mockGetSignedUrl(...a) }));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: (...a: unknown[]) => mockAudit(...a) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));

const itemRoute = await import('@/app/api/superadmin/backups/[id]/route');
const downloadRoute = await import('@/app/api/superadmin/backups/[id]/download/route');

type Req = import('next/server').NextRequest;
const REQ = { url: 'http://localhost/api/superadmin/backups' } as unknown as Req;
const PARAMS = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  selectRows = [];
  updateRows = [];
  lastSetArg = {};
  mockRequireAuth.mockResolvedValue(mockCtx);
  mockGetSignedUrl.mockResolvedValue('https://storage.example.test/signed?X-Amz-Signature=abc');
});

describe('GET /api/superadmin/backups/[id]', () => {
  it('refuses a non super admin', async () => {
    mockRequireAuth.mockResolvedValue({ ...mockCtx, isSuperAdmin: false });
    const res = await itemRoute.GET(REQ, PARAMS('b1'));
    expect(res.status).toBe(403);
  });

  it('404s for a row the list does not return', async () => {
    selectRows = [];
    const res = await itemRoute.GET(REQ, PARAMS('missing'));
    expect(res.status).toBe(404);
  });

  it('returns the record', async () => {
    selectRows = [{ id: 'b1', status: 'completed' }];
    const res = await itemRoute.GET(REQ, PARAMS('b1'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: { id: 'b1', status: 'completed' } });
  });
});

describe('DELETE /api/superadmin/backups/[id]', () => {
  it('soft deletes: stamps the audit columns, sets nothing else', async () => {
    updateRows = [{ id: 'b1', storageType: 's3' }];
    const res = await itemRoute.DELETE(REQ, PARAMS('b1'));
    expect(res.status).toBe(200);
    expect(lastSetArg.deletedAt).toBeInstanceOf(Date);
    expect(lastSetArg.deletedBy).toBe('admin-1');
    expect(Object.keys(lastSetArg).sort()).toEqual(['deletedAt', 'deletedBy', 'updatedAt']);
  });

  it('records the action in the super admin audit trail', async () => {
    updateRows = [{ id: 'b1', storageType: 's3' }];
    await itemRoute.DELETE(REQ, PARAMS('b1'));
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      adminId: 'admin-1', action: 'backup.deleted',
    });
  });

  it('404s rather than claiming success for a row that was already gone', async () => {
    updateRows = [];
    const res = await itemRoute.DELETE(REQ, PARAMS('b1'));
    expect(res.status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('GET /api/superadmin/backups/[id]/download', () => {
  it('redirects an object-storage archive to a short-lived signed URL', async () => {
    selectRows = [{ storagePath: 'backups/dump.sql', storageType: 's3', status: 'completed' }];
    const res = await downloadRoute.GET(REQ, PARAMS('b1'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://storage.example.test/signed?X-Amz-Signature=abc');
    expect(mockGetSignedUrl).toHaveBeenCalledWith('backups/dump.sql', 300);
  });

  it('refuses a volume-local backup instead of signing a key that is not in storage', async () => {
    selectRows = [{ storagePath: '/var/lib/nucrm/dump.sql', storageType: 'local', status: 'completed' }];
    const res = await downloadRoute.GET(REQ, PARAMS('b1'));
    expect(res.status).toBe(409);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a backup that never finished, and one with no path', async () => {
    selectRows = [{ storagePath: 'backups/dump.sql', storageType: 's3', status: 'failed' }];
    expect((await downloadRoute.GET(REQ, PARAMS('b1'))).status).toBe(409);
    selectRows = [{ storagePath: null, storageType: 's3', status: 'completed' }];
    expect((await downloadRoute.GET(REQ, PARAMS('b2'))).status).toBe(409);
  });

  it('404s for an unknown or soft-deleted row', async () => {
    selectRows = [];
    expect((await downloadRoute.GET(REQ, PARAMS('nope'))).status).toBe(404);
  });
});
