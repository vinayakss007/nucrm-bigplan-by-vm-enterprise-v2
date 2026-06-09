import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockDbSelect = vi.fn(() => ({ from: (...args: any[]) => mockFrom(...args) }));
const mockDbExecute = vi.fn();

mockFrom.mockReturnValue({ where: (...args: any[]) => mockWhere(...args) });
mockWhere.mockResolvedValue([]);

const mockSqlIdentifier = vi.fn((name: string) => ({ type: 'identifier', name }));
const mockSql = Object.assign(
  (strings: TemplateStringsArray, ...values: any[]) => ({
    query: strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? `$${i + 1}` : ''), ''),
    strings, values,
  }),
  { identifier: mockSqlIdentifier, join: vi.fn(), raw: vi.fn() }
);

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (...args: any[]) => mockDbExecute(...args),
    select: (...args: any[]) => mockDbSelect(...args),
  },
}));

vi.mock('@/drizzle/schema/_registry', () => ({
  TABLE_REGISTRY: {
    tenants: { table: 'tenants' },
    contacts: { table: 'contacts' },
  },
  TableName: {},
}));

vi.mock('drizzle-orm', () => ({ sql: mockSql }));

describe('TenantDataExporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('stores tenant id', async () => {
      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');
      expect((exporter as any).tenantId).toBe('tenant-1');
    });
  });

  describe('exportAll', () => {
    it('exports all tables for a tenant', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ name: 'Test Tenant' }] });

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');
      const result = await exporter.exportAll(['tenants']);

      expect(result.tenantId).toBe('tenant-1');
      expect(result.tenantName).toBe('Test Tenant');
      expect(result.tableCount).toBe(1);
      expect(result.totalRecords).toBe(0);
      expect(result.exportedAt).toBeDefined();
      expect(result.dataSize).toBeGreaterThan(0);
    });

    it('handles missing tenant gracefully', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-none');
      const result = await exporter.exportAll(['tenants']);

      expect(result.tenantName).toBeUndefined();
    });

    it('handles table-level errors gracefully', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ name: 'Test' }] })
        .mockRejectedValueOnce(new Error('table not found'));

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');

      const result = await exporter.exportAll(['contacts', 'tenants']);
      expect(result.tableCount).toBe(2);
    });

    it('throws on critical errors', async () => {
      mockDbExecute.mockReset();
      mockDbExecute.mockRejectedValue(new Error('Connection lost'));

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');

      await expect(exporter.exportAll(['tenants'])).rejects.toThrow('Connection lost');
    });

    it('includes empty tables for schema', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ name: 'Test' }] });

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');
      const result = await exporter.exportAll(['tenants']);

      expect(result.tables['tenants']).toBeDefined();
    });
  });

  describe('exportAsSQL', () => {
    it('generates SQL INSERT statements', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ name: 'Test' }] });
      mockWhere.mockResolvedValue([{ id: '1', name: 'Test', tenant_id: 't-1', score: 42, is_active: true, metadata: null }]);

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');
      const sql = await exporter.exportAsSQL(['contacts']);

      expect(sql).toContain('BEGIN;');
      expect(sql).toContain('COMMIT;');
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('ON CONFLICT DO NOTHING');
    });

    it('handles boolean and number values in SQL output', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ name: 'Test' }] });
      mockWhere.mockResolvedValue([{ id: '1', name: 'Test', count: 42, active: true, tags: null }]);

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');
      const sql = await exporter.exportAsSQL(['contacts']);

      expect(sql).toContain('42');
      expect(sql).toContain('true');
    });

    it('skips empty tables in SQL output', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ name: 'Test' }] });
      mockWhere.mockResolvedValue([]);

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');
      const sql = await exporter.exportAsSQL(['contacts']);

      expect(sql).not.toContain('INSERT INTO');
    });

    it('escapes single quotes in SQL values', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ name: 'Test' }] });
      mockWhere.mockResolvedValue([{ id: '1', name: "O'Brien", tenant_id: 't-1' }]);

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');
      const sql = await exporter.exportAsSQL(['contacts']);

      expect(sql).toContain("O''Brien");
    });
  });

  describe('getTableStats', () => {
    it('returns row counts for tables with data', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValue({ rows: [{ count: 0 }] });

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');

      const stats = await exporter.getTableStats();
      expect(Array.isArray(stats)).toBe(true);
    });

    it('handles errors for missing tables', async () => {
      mockDbExecute
        .mockRejectedValueOnce(new Error('relation does not exist'))
        .mockResolvedValue({ rows: [{ count: 0 }] });

      const { TenantDataExporter } = await import('@/lib/tenant-data-export');
      const exporter = new TenantDataExporter('tenant-1');

      const stats = await exporter.getTableStats();
      expect(Array.isArray(stats)).toBe(true);
    });
  });
});
