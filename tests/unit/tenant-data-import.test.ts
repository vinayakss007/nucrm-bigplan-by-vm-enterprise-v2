import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTxExecute = vi.fn();
const mockDbTransaction = vi.fn();
const mockDbTransactionThrow = vi.fn();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
mockDbTransaction.mockImplementation((cb: any) => cb({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (...args: any[]) => mockTxExecute(...args),
}));

const mockSqlIdentifier = vi.fn((name: string) => ({ type: 'identifier', name }));
const mockSqlJoin = vi.fn();
const mockSqlRaw = vi.fn();
const mockSql = Object.assign(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  (strings: TemplateStringsArray, ...values: any[]) => ({
    query: strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? `$${i + 1}` : ''), ''),
    strings, values,
  }),
  { identifier: mockSqlIdentifier, join: mockSqlJoin, raw: mockSqlRaw }
);

vi.mock('@/drizzle/db', () => ({
  db: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: (cb: any) => mockDbTransaction(cb),
    execute: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({ sql: mockSql }));

describe('TenantDataImporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockDbTransaction.mockImplementation((cb: any) => cb({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: (...args: any[]) => mockTxExecute(...args),
    }));
  });

  describe('constructor', () => {
    it('stores tenant id', async () => {
      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((importer as any).tenantId).toBe('tenant-1');
    });
  });

  describe('importAll', () => {
    it('imports all tables successfully', async () => {
      mockTxExecute.mockResolvedValue({ rowCount: 1 });

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');

      const tables = {
        contacts: {
          columns: ['id', 'name', 'email'],
          rows: [
            { id: '1', name: 'Alice', email: 'alice@test.com' },
            { id: '2', name: 'Bob', email: 'bob@test.com' },
          ],
        },
      };

      const result = await importer.importAll(tables);

      expect(result.tablesRestored).toBe(1);
      expect(result.recordsRestored).toBe(2);
      expect(result.errors).toEqual([]);
    });

    it('handles empty table data', async () => {
      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');

      const tables = {
        contacts: { columns: ['id', 'name'], rows: [] },
      };

      const result = await importer.importAll(tables);

      expect(result.tablesRestored).toBe(1);
      expect(result.recordsRestored).toBe(0);
    });

    it('handles per-row errors gracefully in importTable', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockRejectedValueOnce(new Error('constraint violation'));

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');

      const tables = {
        contacts: {
          columns: ['id', 'name'],
          rows: [{ id: '1', name: 'Alice' }],
        },
        bad_table: {
          columns: ['id'],
          rows: [{ id: '1' }],
        },
      };

      const result = await importer.importAll(tables);

      expect(result.tablesRestored).toBe(2);
      expect(result.recordsRestored).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('handles empty tables object', async () => {
      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');

      const result = await importer.importAll({});

      expect(result.tablesRestored).toBe(0);
      expect(result.recordsRestored).toBe(0);
    });

    it('throws when transaction fails', async () => {
      mockDbTransaction.mockReset();
      mockDbTransaction.mockImplementation(() => {
        throw new Error('Transaction error');
      });

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');

      await expect(importer.importAll({})).rejects.toThrow('Import transaction failed');
    });
  });

  describe('deleteExistingData', () => {
    it('deletes all tables in reverse dependency order', async () => {
      mockTxExecute.mockResolvedValue({ rowCount: 5 });

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');

      await importer.deleteExistingData();

      expect(mockTxExecute).toHaveBeenCalled();
    });

    it('skips tables in skipTables list', async () => {
      mockTxExecute.mockResolvedValue({ rowCount: 5 });

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');

      await importer.deleteExistingData(['contacts']);

      expect(mockTxExecute).toHaveBeenCalled();
    });

    it('throws when transaction fails', async () => {
      mockDbTransaction.mockReset();
      mockDbTransaction.mockImplementation(() => {
        throw new Error('Transaction failed');
      });

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');
      const importer = new TenantDataImporter('tenant-1');

      await expect(importer.deleteExistingData()).rejects.toThrow('Delete failed');
    });
  });

  describe('importFromSQL', () => {
    it('imports SQL statements', async () => {
      mockTxExecute.mockReset();
      mockTxExecute.mockResolvedValue({ rowCount: 1 });
      mockSqlRaw.mockImplementation((str: string) => ({ type: 'raw', value: str }));

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');

      const sqlString = `
        BEGIN;
        INSERT INTO "contacts" ("id", "name") VALUES ('1', 'Alice');
        INSERT INTO "contacts" ("id", "name") VALUES ('2', 'Bob');
        COMMIT;
      `;

      const result = await TenantDataImporter.importFromSQL('tenant-1', sqlString);

      expect(result.tablesRestored).toBe(1);
      expect(result.recordsRestored).toBe(2);
    });

    it('handles SQL execution errors', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockRejectedValueOnce(new Error('duplicate key'));
      mockSqlRaw.mockImplementation((str: string) => ({ type: 'raw', value: str }));

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');

      const sqlString = `
        INSERT INTO "contacts" ("id") VALUES ('1');
        INSERT INTO "contacts" ("id") VALUES ('1');
      `;

      const result = await TenantDataImporter.importFromSQL('tenant-1', sqlString);

      expect(result.errors).toHaveLength(1);
    });

    it('handles empty SQL string', async () => {
      mockSqlRaw.mockImplementation((str: string) => ({ type: 'raw', value: str }));

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');

      const result = await TenantDataImporter.importFromSQL('tenant-1', '');

      expect(result.tablesRestored).toBe(1);
      expect(result.recordsRestored).toBe(0);
    });

    it('filters out comments and BEGIN/COMMIT statements', async () => {
      mockSqlRaw.mockImplementation((str: string) => ({ type: 'raw', value: str }));

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');

      const result = await TenantDataImporter.importFromSQL('tenant-1', '-- comment\nBEGIN;\nCOMMIT;');

      expect(result.tablesRestored).toBe(1);
    });

    it('throws when transaction fails', async () => {
      mockSqlRaw.mockImplementation((str: string) => ({ type: 'raw', value: str }));
      mockDbTransaction.mockReset();
      mockDbTransaction.mockImplementation(() => {
        throw new Error('Transaction error');
      });

      const { TenantDataImporter } = await import('@/lib/tenant-data-import');

      await expect(
        TenantDataImporter.importFromSQL('tenant-1', 'INSERT INTO test VALUES (1)')
      ).rejects.toThrow('SQL import failed');
    });
  });
});
