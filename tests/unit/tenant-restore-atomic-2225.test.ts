/**
 * Issue #2225 (HIGH) — tenant restore must be atomic: the wipe of existing
 * tenant data and the import of the backup must live in ONE transaction, so
 * any import failure rolls everything back and the tenant's old data stays
 * intact. The restore transaction also takes a per-tenant
 * `pg_try_advisory_xact_lock` so concurrent restores can never interleave.
 *
 * Mock pattern follows tests/unit/tenant-data-import.test.ts (thenable/mock
 * db with a fake transaction that records COMMIT vs ROLLBACK).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTxExecute = vi.fn();
const mockDbTransaction = vi.fn();

// Fake transaction semantics: a callback that resolves is COMMITted, a
// callback that throws is ROLLBACKed. Counting the two proves the atomicity
// guarantee under test: after a failed import there must be a rollback and
// NO commit of the wipe.
let commitCount = 0;
let rollbackCount = 0;

vi.mock('@/drizzle/db', () => ({
  db: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: (cb: any) => mockDbTransaction(cb),
    execute: vi.fn(),
  },
}));

const mockSqlIdentifier = vi.fn((name: string) => ({ type: 'identifier', name }));
const mockSqlJoin = vi.fn();
const mockSql = Object.assign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (strings: TemplateStringsArray, ...values: any[]) => ({
    query: strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? `$${i + 1}` : ''), ''),
    strings,
    values,
  }),
  { identifier: mockSqlIdentifier, join: mockSqlJoin, raw: vi.fn() },
);

vi.mock('drizzle-orm', () => ({ sql: mockSql }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isLockCall(arg: any): boolean {
  const text = arg?.strings?.[0] ?? arg?.query ?? '';
  return String(text).includes('pg_try_advisory_xact_lock');
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isInsertCall(arg: any): boolean {
  const text = arg?.strings?.[0] ?? '';
  return String(text).startsWith('INSERT INTO');
}

const tables = {
  contacts: { columns: ['id', 'name'], rows: [{ id: '1', name: 'Alice' }] },
};

describe('TenantDataImporter.restore — atomic wipe + import (#2225)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitCount = 0;
    rollbackCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockDbTransaction.mockImplementation(async (cb: any) => {
      try {
        const res = await cb({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          execute: (...args: any[]) => mockTxExecute(...args),
        });
        commitCount++;
        return res;
      } catch (err) {
        rollbackCount++;
        throw err;
      }
    });
    mockTxExecute.mockImplementation(async (query: unknown) => {
      if (isLockCall(query)) return { rows: [{ acquired: true }] };
      return { rowCount: 1 };
    });
  });

  it('runs lock + wipe + import inside a SINGLE transaction and commits', async () => {
    const { TenantDataImporter } = await import('@/lib/tenant-data-import');
    const importer = new TenantDataImporter('tenant-1');

    const result = await importer.restore(tables, { deleteExisting: true });

    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ tablesRestored: 1, recordsRestored: 1, errors: [] });

    // First statement is the per-tenant advisory xact lock, then wipes, then inserts.
    const firstCall = mockTxExecute.mock.calls[0]?.[0];
    expect(isLockCall(firstCall)).toBe(true);
    const allQueries = mockTxExecute.mock.calls.map(([q]) => String(q?.strings?.[0] ?? ''));
    expect(allQueries.some((q) => q.startsWith('DELETE FROM'))).toBe(true);
    expect(allQueries.some((q) => q.startsWith('INSERT INTO'))).toBe(true);
    expect(commitCount).toBe(1);
    expect(rollbackCount).toBe(0);
  });

  it('rolls the wipe BACK when an import statement fails — no committed delete, old data intact', async () => {
    const { TenantDataImporter } = await import('@/lib/tenant-data-import');
    const importer = new TenantDataImporter('tenant-1');

    // Simulate the exact failure the issue describes: wipe succeeds, one
    // INSERT blows up (bad row cast / FK order / whatever).
    mockTxExecute.mockImplementation(async (query: unknown) => {
      if (isLockCall(query)) return { rows: [{ acquired: true }] };
      if (isInsertCall(query)) throw new Error('invalid input syntax for type uuid: "bogus"');
      return { rowCount: 42 };
    });

    await expect(importer.restore(tables, { deleteExisting: true })).rejects.toThrow(
      'invalid input syntax for type uuid',
    );

    // The wipe statements DID run, but only inside the transaction that then
    // rolled back: nothing is committed, so the tenant's data is untouched.
    expect(mockTxExecute.mock.calls.some(([q]) => String(q?.strings?.[0] ?? '').startsWith('DELETE FROM'))).toBe(true);
    expect(commitCount).toBe(0);
    expect(rollbackCount).toBe(1);
    // Atomicity: delete+import shared ONE transaction (vs the old two-phase path).
    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
  });

  it('fails fast with TenantRestoreConflictError when another restore holds the lock, touching nothing', async () => {
    const { TenantDataImporter } = await import('@/lib/tenant-data-import');
    const { TenantRestoreConflictError } = await import('@/lib/tenant-restore-lock');
    const importer = new TenantDataImporter('tenant-1');

    mockTxExecute.mockImplementation(async (query: unknown) => {
      if (isLockCall(query)) return { rows: [{ acquired: false }] };
      return { rowCount: 1 };
    });

    await expect(importer.restore(tables, { deleteExisting: true })).rejects.toBeInstanceOf(
      TenantRestoreConflictError,
    );

    // Only the lock probe ran — no wipe, no insert.
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(commitCount).toBe(0);
    expect(rollbackCount).toBe(1);
  });

  it('propagates table-allowlist violations instead of swallowing them (no partial restore)', async () => {
    const { TenantDataImporter } = await import('@/lib/tenant-data-import');
    const importer = new TenantDataImporter('tenant-1');

    await expect(
      importer.restore({ not_a_real_table: { columns: ['id'], rows: [{ id: '1' }] } }, {}),
    ).rejects.toThrow("Table 'not_a_real_table' is not allowed for import");
    expect(commitCount).toBe(0);
  });

  it('restores without wiping when deleteExisting is false', async () => {
    const { TenantDataImporter } = await import('@/lib/tenant-data-import');
    const importer = new TenantDataImporter('tenant-1');

    const result = await importer.restore(tables, { deleteExisting: false });

    expect(result.tablesRestored).toBe(1);
    const allQueries = mockTxExecute.mock.calls.map(([q]) => String(q?.strings?.[0] ?? ''));
    expect(allQueries.some((q) => q.startsWith('DELETE FROM'))).toBe(false);
    expect(commitCount).toBe(1);
  });

  it('uses a stable per-tenant advisory lock key namespaced for restores', async () => {
    const { tenantRestoreLockId } = await import('@/lib/tenant-restore-lock');
    expect(tenantRestoreLockId('tenant-1')).toBe(tenantRestoreLockId('tenant-1'));
    expect(tenantRestoreLockId('tenant-1')).not.toBe(tenantRestoreLockId('tenant-2'));
    expect(Number.isInteger(tenantRestoreLockId('tenant-1'))).toBe(true);
  });
});
