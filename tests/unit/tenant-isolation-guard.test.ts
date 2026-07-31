/**
 * Tests for lib/db/tenant-isolation-guard.ts
 */
import { describe, it, expect, vi } from 'vitest';
import {
  hasTenantFilter,
  assertTenantScoped,
  findUnfilteredQueries,
  TENANT_SCOPED_TABLES,
  GLOBAL_TABLES,
} from '@/lib/db/tenant-isolation-guard';

describe('hasTenantFilter', () => {
  it('returns true when tenant_id is in WHERE clause', () => {
    const sql = 'SELECT * FROM contacts WHERE tenant_id = $1 AND deleted_at IS NULL';
    expect(hasTenantFilter(sql, 'contacts')).toBe(true);
  });

  it('returns true for quoted tenant_id', () => {
    const sql = 'SELECT * FROM "contacts" WHERE "tenant_id" = $1';
    expect(hasTenantFilter(sql, 'contacts')).toBe(true);
  });

  it('returns false when tenant_id is missing from SELECT', () => {
    const sql = 'SELECT * FROM contacts WHERE id = $1';
    expect(hasTenantFilter(sql, 'contacts')).toBe(false);
  });

  it('returns true when table is not in query', () => {
    const sql = 'SELECT * FROM users WHERE tenant_id = $1';
    expect(hasTenantFilter(sql, 'contacts')).toBe(true);
  });

  it('returns true for INSERT statements (always scoped)', () => {
    const sql = 'INSERT INTO contacts (id, name) VALUES ($1, $2)';
    expect(hasTenantFilter(sql, 'contacts')).toBe(true);
  });

  it('returns true for CREATE TABLE', () => {
    const sql = 'CREATE TABLE contacts (id uuid)';
    expect(hasTenantFilter(sql, 'contacts')).toBe(true);
  });

  it('returns true when tenantId appears (camelCase variant)', () => {
    const sql = "SELECT * FROM contacts WHERE tenantId = '123'";
    expect(hasTenantFilter(sql, 'contacts')).toBe(true);
  });

  it('returns false for DELETE without tenant filter', () => {
    const sql = 'DELETE FROM contacts WHERE id = $1';
    expect(hasTenantFilter(sql, 'contacts')).toBe(false);
  });

  it('returns false for UPDATE without tenant filter', () => {
    const sql = "UPDATE deals SET status = 'won' WHERE id = $1";
    expect(hasTenantFilter(sql, 'deals')).toBe(false);
  });

  it('returns true for UPDATE with tenant filter', () => {
    const sql = "UPDATE deals SET status = 'won' WHERE id = $1 AND tenant_id = $2";
    expect(hasTenantFilter(sql, 'deals')).toBe(true);
  });

  it('handles subqueries with tenant references', () => {
    const sql = 'SELECT * FROM contacts WHERE id IN (SELECT contact_id FROM activities WHERE tenant_id = $1)';
    expect(hasTenantFilter(sql, 'contacts')).toBe(true);
  });
});

describe('assertTenantScoped', () => {
  it('does nothing for tenant-scoped query', () => {
    expect(() => {
      assertTenantScoped(
        'SELECT * FROM contacts WHERE tenant_id = $1',
        'contacts',
        true,
      );
    }).not.toThrow();
  });

  it('does nothing for global tables', () => {
    expect(() => {
      assertTenantScoped(
        'SELECT * FROM tenants WHERE id = $1',
        'tenants',
        true,
      );
    }).not.toThrow();
  });

  it('throws in strict mode when tenant_id missing', () => {
    expect(() => {
      assertTenantScoped(
        'SELECT * FROM contacts WHERE id = $1',
        'contacts',
        true,
      );
    }).toThrow(/TENANT ISOLATION/);
  });

  it('warns (does not throw) in lenient mode', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    assertTenantScoped(
      'SELECT * FROM deals WHERE id = $1',
      'deals',
      false,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('TENANT ISOLATION'),
    );
    warnSpy.mockRestore();
  });

  it('ignores non-tenant-scoped tables', () => {
    expect(() => {
      assertTenantScoped(
        'SELECT * FROM plans WHERE id = $1',
        'plans',
        true,
      );
    }).not.toThrow();
  });
});

describe('findUnfilteredQueries', () => {
  it('returns empty for properly scoped queries', () => {
    const queries = [
      { sql: 'SELECT * FROM contacts WHERE tenant_id = $1', table: 'contacts' },
      { sql: 'SELECT * FROM deals WHERE tenant_id = $1 AND id = $2', table: 'deals' },
    ];

    expect(findUnfilteredQueries(queries)).toEqual([]);
  });

  it('detects unfiltered queries with explicit table', () => {
    const queries = [
      { sql: 'SELECT * FROM contacts WHERE id = $1', table: 'contacts' },
    ];

    const violations = findUnfilteredQueries(queries);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.tables).toEqual(['contacts']);
  });

  it('detects unfiltered queries without explicit table (auto-detect)', () => {
    const queries = [
      { sql: 'SELECT * FROM contacts WHERE id = $1' },
    ];

    const violations = findUnfilteredQueries(queries);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.tables).toContain('contacts');
  });

  it('ignores global tables', () => {
    const queries = [
      { sql: 'SELECT * FROM tenants WHERE id = $1', table: 'tenants' },
      { sql: 'SELECT * FROM plans', table: 'plans' },
    ];

    expect(findUnfilteredQueries(queries)).toEqual([]);
  });

  it('returns multiple violations', () => {
    const queries = [
      { sql: 'SELECT * FROM contacts WHERE id = $1', table: 'contacts' },
      { sql: 'DELETE FROM deals WHERE id = $1', table: 'deals' },
      { sql: 'SELECT * FROM leads WHERE tenant_id = $1', table: 'leads' },
    ];

    const violations = findUnfilteredQueries(queries);
    expect(violations).toHaveLength(2);
  });

  it('truncates long queries in violation report', () => {
    const longSql = 'SELECT ' + 'x'.repeat(600) + ' FROM contacts WHERE id = $1';
    const queries = [{ sql: longSql, table: 'contacts' }];

    const violations = findUnfilteredQueries(queries);
    expect(violations[0]!.query.length).toBeLessThanOrEqual(500);
  });
});

describe('table lists', () => {
  it('tenant scoped tables contains core CRM tables', () => {
    expect(TENANT_SCOPED_TABLES).toContain('contacts');
    expect(TENANT_SCOPED_TABLES).toContain('deals');
    expect(TENANT_SCOPED_TABLES).toContain('leads');
    expect(TENANT_SCOPED_TABLES).toContain('audit_logs');
    expect(TENANT_SCOPED_TABLES).toContain('api_keys');
  });

  it('global tables contains system tables', () => {
    expect(GLOBAL_TABLES).toContain('tenants');
    expect(GLOBAL_TABLES).toContain('plans');
  });

  it('no overlap between scoped and global', () => {
    const overlap = TENANT_SCOPED_TABLES.filter((t) =>
      (GLOBAL_TABLES as readonly string[]).includes(t),
    );
    expect(overlap).toEqual([]);
  });
});
