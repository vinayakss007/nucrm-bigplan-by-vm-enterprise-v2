/**
 * Unit tests for lib/restore/restore-executor.ts
 *
 * The executor decides the ORDER in which customer tables are written back and
 * which rows get skipped. Dropping a table from the restore order, or silently
 * skipping statements, loses customer data, so those two behaviours are
 * asserted directly. The database is mocked; drizzle's `sql` template is real
 * so that query construction still has to succeed.
 */

import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type ExecResult = { rows: Record<string, unknown>[]; rowCount: number };
type Tx = { execute: (query: unknown) => Promise<ExecResult> };

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  txExecute: vi.fn(),
  transaction: vi.fn(),
  insertValuesReturning: vi.fn(),
  findFirstTenant: vi.fn(),
  findFirstSnapshot: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: mocks.execute,
    transaction: mocks.transaction,
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: mocks.insertValuesReturning })),
    })),
    query: {
      tenants: { findFirst: mocks.findFirstTenant },
      restoreSnapshots: { findFirst: mocks.findFirstSnapshot },
    },
  },
}));

import {
  orderTablesByDependency,
  executeSelectiveRestore,
  createPreRestoreSnapshot,
  rollbackToSnapshot,
  countExistingRecords,
  validateTenant,
  type RestoreProgress,
} from '@/lib/restore/restore-executor';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('orderTablesByDependency', () => {
  it('returns parents before children for known tables', () => {
    const ordered = orderTablesByDependency(['tasks', 'contacts', 'tenants', 'deals']);
    expect(ordered.indexOf('tenants')).toBeLessThan(ordered.indexOf('contacts'));
    expect(ordered.indexOf('contacts')).toBeLessThan(ordered.indexOf('tasks'));
    expect(ordered.indexOf('deals')).toBeLessThan(ordered.indexOf('tasks'));
  });

  it('puts configuration tables before the core CRM entities that reference them', () => {
    const ordered = orderTablesByDependency(['contacts', 'pipelines', 'deal_stages', 'deals']);
    expect(ordered).toEqual(['pipelines', 'deal_stages', 'contacts', 'deals']);
  });

  it('puts a junction table after both of its parents', () => {
    const ordered = orderTablesByDependency(['contact_tags', 'tags', 'contacts']);
    expect(ordered).toEqual(['tags', 'contacts', 'contact_tags']);
  });

  it('is independent of input order', () => {
    const input = ['activities', 'roles', 'deals', 'tenants', 'notes'];
    const forward = orderTablesByDependency(input);
    const reversed = orderTablesByDependency([...input].reverse());
    expect(reversed).toEqual(forward);
  });

  it('appends unknown tables after all known tables, preserving their relative order', () => {
    const ordered = orderTablesByDependency([
      'zzz_custom',
      'contacts',
      'aaa_custom',
      'tenants',
    ]);
    expect(ordered).toEqual(['tenants', 'contacts', 'zzz_custom', 'aaa_custom']);
  });

  it('never drops or duplicates an input table', () => {
    const input = [
      'tasks', 'contacts', 'unknown_one', 'tenants', 'unknown_two',
      'deals', 'audit_logs', 'forms', 'notifications',
    ];
    const ordered = orderTablesByDependency(input);
    expect(ordered).toHaveLength(input.length);
    expect([...ordered].sort()).toEqual([...input].sort());
  });

  it('preserves duplicated input entries rather than de-duplicating them', () => {
    // Documented behaviour: the function is an ordering, not a set operation.
    const ordered = orderTablesByDependency(['contacts', 'contacts', 'tenants']);
    expect(ordered).toEqual(['tenants', 'contacts', 'contacts']);
  });

  it('returns an empty array for empty input', () => {
    expect(orderTablesByDependency([])).toEqual([]);
  });

  it('passes through a list of only unknown tables unchanged', () => {
    expect(orderTablesByDependency(['x', 'y', 'z'])).toEqual(['x', 'y', 'z']);
  });

  it('does not mutate the caller-supplied array', () => {
    const input = ['tasks', 'tenants'];
    orderTablesByDependency(input);
    expect(input).toEqual(['tasks', 'tenants']);
  });
});

describe('validateTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts an active tenant and returns it', async () => {
    const tenant = { id: TENANT_A, name: 'Acme', slug: 'acme', status: 'active' };
    mocks.findFirstTenant.mockResolvedValue(tenant);

    const result = await validateTenant(TENANT_A);
    expect(result).toEqual({ valid: true, tenant });
  });

  it('rejects a tenant that does not exist', async () => {
    mocks.findFirstTenant.mockResolvedValue(undefined);
    expect(await validateTenant(TENANT_A)).toEqual({
      valid: false,
      error: 'Tenant not found',
    });
  });

  it('rejects a suspended tenant', async () => {
    mocks.findFirstTenant.mockResolvedValue({ id: TENANT_A, status: 'suspended' });
    expect(await validateTenant(TENANT_A)).toEqual({
      valid: false,
      error: 'Tenant is suspended',
    });
  });

  it('rejects a deleted tenant', async () => {
    mocks.findFirstTenant.mockResolvedValue({ id: TENANT_A, status: 'deleted' });
    expect(await validateTenant(TENANT_A)).toEqual({
      valid: false,
      error: 'Tenant is deleted',
    });
  });

  it('accepts other statuses, e.g. trialing', async () => {
    mocks.findFirstTenant.mockResolvedValue({ id: TENANT_A, status: 'trialing' });
    expect((await validateTenant(TENANT_A)).valid).toBe(true);
  });
});

describe('countExistingRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the count per table', async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ cnt: 7 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }], rowCount: 1 });

    expect(await countExistingRecords(TENANT_A, ['contacts', 'deals'])).toEqual({
      contacts: 7,
      deals: 0,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('defaults to 0 when the query returns no rows', async () => {
    mocks.execute.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await countExistingRecords(TENANT_A, ['contacts'])).toEqual({ contacts: 0 });
  });

  it('defaults to 0 when the table does not exist (query throws)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.execute.mockRejectedValue(new Error('relation "ghost" does not exist'));
    expect(await countExistingRecords(TENANT_A, ['ghost'])).toEqual({ ghost: 0 });
    errSpy.mockRestore();
  });

  it('returns an empty object for no tables', async () => {
    expect(await countExistingRecords(TENANT_A, [])).toEqual({});
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe('createPreRestoreSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('snapshots every requested table and returns the new snapshot id', async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }, { id: 'c2' }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: 'd1' }], rowCount: 1 });
    mocks.insertValuesReturning.mockResolvedValue([{ id: 'snap-1' }]);

    const id = await createPreRestoreSnapshot(TENANT_A, ['contacts', 'deals']);
    expect(id).toBe('snap-1');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('rejects a table name that is not on the SQL allowlist', async () => {
    await expect(
      createPreRestoreSnapshot(TENANT_A, ['contacts; DROP TABLE users'])
    ).rejects.toThrow(/Invalid table name/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('treats a missing table as an empty snapshot instead of failing the restore', async () => {
    mocks.execute.mockRejectedValue(new Error('relation does not exist'));
    mocks.insertValuesReturning.mockResolvedValue([{ id: 'snap-2' }]);
    await expect(createPreRestoreSnapshot(TENANT_A, ['contacts'])).resolves.toBe('snap-2');
  });

  it('throws when the snapshot row cannot be written', async () => {
    mocks.execute.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.insertValuesReturning.mockResolvedValue([]);
    await expect(createPreRestoreSnapshot(TENANT_A, ['contacts'])).rejects.toThrow(
      'Failed to create snapshot record'
    );
  });
});

describe('rollbackToSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (cb: (tx: Tx) => Promise<unknown>) =>
        cb({ execute: mocks.txExecute as unknown as Tx['execute'] })
    );
    mocks.txExecute.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('throws when the snapshot does not belong to the tenant', async () => {
    mocks.findFirstSnapshot.mockResolvedValue(undefined);
    await expect(rollbackToSnapshot('snap-1', TENANT_A)).rejects.toThrow('Snapshot not found');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('deletes current rows then re-inserts every snapshot row', async () => {
    mocks.findFirstSnapshot.mockResolvedValue({
      id: 'snap-1',
      tenantId: TENANT_A,
      snapshotData: {
        contacts: [
          { id: 'c1', tenant_id: TENANT_A, name: 'A' },
          { id: 'c2', tenant_id: TENANT_A, name: 'B' },
        ],
      },
    });

    await rollbackToSnapshot('snap-1', TENANT_A);
    // 1 DELETE + 2 INSERTs
    expect(mocks.txExecute).toHaveBeenCalledTimes(3);
  });

  it('still deletes current rows for a table whose snapshot is empty', async () => {
    mocks.findFirstSnapshot.mockResolvedValue({
      id: 'snap-1',
      tenantId: TENANT_A,
      snapshotData: { contacts: [], deals: [] },
    });

    await rollbackToSnapshot('snap-1', TENANT_A);
    expect(mocks.txExecute).toHaveBeenCalledTimes(2);
  });
});

describe('executeSelectiveRestore', () => {
  let dir: string;
  let backup: string;
  let progress: RestoreProgress[];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nucrm-restore-exec-'));
    backup = join(dir, 'backup.sql');
    writeFileSync(
      backup,
      [
        `INSERT INTO public.contacts (id, tenant_id, name) VALUES ('c1', '${TENANT_A}', 'A');`,
        `INSERT INTO public.contacts (id, tenant_id, name) VALUES ('c2', '${TENANT_A}', 'B, Jr');`,
        `INSERT INTO public.contacts (id, tenant_id, name) VALUES ('c3', '${TENANT_B}', 'Other');`,
        `INSERT INTO public.tenants (id, tenant_id, name) VALUES ('${TENANT_A}', '${TENANT_A}', 'Acme');`,
      ].join('\n')
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    progress = [];
    mocks.transaction.mockImplementation(
      async (cb: (tx: Tx) => Promise<unknown>) =>
        cb({ execute: mocks.txExecute as unknown as Tx['execute'] })
    );
    mocks.txExecute.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  const run = (
    overrides: Partial<Parameters<typeof executeSelectiveRestore>[0]> = {}
  ) =>
    executeSelectiveRestore(
      {
        backupFilePath: backup,
        tenantId: TENANT_A,
        tables: ['contacts'],
        restoreMode: 'insert_only',
        performedBy: 'admin',
        ...overrides,
      },
      p => progress.push(p)
    );

  it('restores only the requested tenant rows in insert_only mode', async () => {
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.recordsAffected).toEqual({ contacts: 2 });
    expect(result.recordsPerTable.contacts).toEqual({ new: 2, updated: 0, skipped: 0 });
    expect(mocks.txExecute).toHaveBeenCalledTimes(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('counts a row as skipped when the database reports no rows affected', async () => {
    mocks.txExecute.mockResolvedValue({ rows: [], rowCount: 0 });
    const result = await run();
    expect(result.recordsPerTable.contacts).toEqual({ new: 0, updated: 0, skipped: 2 });
    expect(result.recordsAffected).toEqual({ contacts: 0 });
  });

  it('records zero counts for a requested table with no rows in the backup', async () => {
    const result = await run({ tables: ['contacts', 'tasks'] });
    expect(result.recordsPerTable.tasks).toEqual({ new: 0, updated: 0, skipped: 0 });
    expect(result.recordsAffected.tasks).toBe(0);
  });

  it('processes tables in FK-dependency order, not the caller-supplied order', async () => {
    const result = await run({ tables: ['contacts', 'tenants'] });
    const tables = progress
      .filter(p => p.step === 'restoring' && p.currentTable)
      .map(p => p.currentTable);
    expect(tables[0]).toBe('tenants');
    expect(tables).toContain('contacts');
    expect(result.success).toBe(true);
  });

  it('emits extracting, restoring and completed progress steps', async () => {
    await run();
    expect(progress[0]?.step).toBe('extracting');
    expect(progress.at(-1)?.step).toBe('completed');
    expect(progress.at(-1)?.status).toBe('completed');
    expect(progress.at(-1)?.currentCount).toBe(2);
    expect(progress.at(-1)?.totalCount).toBe(2);
  });

  it('applies ON CONFLICT DO UPDATE in upsert mode', async () => {
    const result = await run({ restoreMode: 'upsert' });
    expect(result.success).toBe(true);
    expect(result.recordsAffected).toEqual({ contacts: 2 });
    expect(mocks.txExecute).toHaveBeenCalledTimes(2);
  });

  it('runs a bare INSERT in replace mode', async () => {
    const result = await run({ restoreMode: 'replace' });
    expect(result.success).toBe(true);
    expect(result.recordsAffected).toEqual({ contacts: 2 });
  });

  it('filters rows by userId when supplied', async () => {
    const userScoped = join(dir, 'user-scoped.sql');
    const user1 = '33333333-3333-4333-8333-333333333333';
    const user2 = '44444444-4444-4444-8444-444444444444';
    writeFileSync(
      userScoped,
      [
        `INSERT INTO public.contacts (id, tenant_id, user_id) VALUES ('c1', '${TENANT_A}', '${user1}');`,
        `INSERT INTO public.contacts (id, tenant_id, user_id) VALUES ('c2', '${TENANT_A}', '${user2}');`,
      ].join('\n')
    );

    const result = await run({ backupFilePath: userScoped, userId: user1 });
    expect(result.recordsAffected).toEqual({ contacts: 1 });
    expect(mocks.txExecute).toHaveBeenCalledTimes(1);
  });

  it('keeps going and logs when a single row fails to insert', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.txExecute
      .mockRejectedValueOnce(new Error('duplicate key value'))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await run();
    expect(result.success).toBe(true);
    // The failed row is counted neither as new nor as skipped.
    expect(result.recordsPerTable.contacts).toEqual({ new: 1, updated: 0, skipped: 0 });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('reports failure (without throwing) when the transaction itself fails', async () => {
    mocks.transaction.mockRejectedValue(new Error('deadlock detected'));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.error).toBe('deadlock detected');
    expect(progress.at(-1)?.step).toBe('failed');
    expect(progress.at(-1)?.status).toBe('failed');
  });

  it('reports failure when the backup file is missing', async () => {
    const result = await run({ backupFilePath: join(dir, 'nope.sql') });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(progress.at(-1)?.status).toBe('failed');
  });

  it('restores nothing for a tenant that is not in the backup', async () => {
    const result = await run({ tenantId: '99999999-9999-4999-8999-999999999999' });
    expect(result.success).toBe(true);
    expect(result.recordsAffected).toEqual({ contacts: 0 });
    expect(mocks.txExecute).not.toHaveBeenCalled();
  });

  it('restores rows from a dump written with quoted identifiers', async () => {
    // Previously `INSERT INTO "contacts"` was unparseable, so extractTenantSQL
    // yielded nothing and the restore "succeeded" having written no customer
    // data at all. This is the regression test for that silent total loss.
    const quoted = join(dir, 'quoted.sql');
    writeFileSync(
      quoted,
      [
        `INSERT INTO "contacts" (id, tenant_id) VALUES ('c1', '${TENANT_A}');`,
        `INSERT INTO "public"."contacts" (id, tenant_id) VALUES ('c2', '${TENANT_A}');`,
      ].join('\n')
    );

    const result = await run({ backupFilePath: quoted });
    expect(result.success).toBe(true);
    expect(result.recordsAffected).toEqual({ contacts: 2 });
    expect(result.unparsedStatements).toBe(0);
    expect(mocks.txExecute).toHaveBeenCalledTimes(2);
  });

  it('admits to being partial when a statement could not be parsed', async () => {
    // The rows that DID parse are still committed — aborting would lose them
    // too — but the result must not read as a clean success.
    const partial = join(dir, 'partial.sql');
    writeFileSync(
      partial,
      [
        `INSERT INTO public.contacts (id, tenant_id) VALUES ('c1', '${TENANT_A}');`,
        `INSERT INTO public.contacts VALUES ('c2', '${TENANT_A}');`,
      ].join('\n')
    );

    const result = await run({ backupFilePath: partial });
    expect(result.recordsAffected).toEqual({ contacts: 1 });
    expect(result.unparsedStatements).toBe(1);
    expect(result.error).toMatch(/could not be parsed/);
    expect(result.error).toMatch(/PARTIAL/);
  });

  it('reports zero unparsed statements for a clean dump', async () => {
    const result = await run();
    expect(result.unparsedStatements).toBe(0);
    expect(result.error).toBeUndefined();
  });
});
