/**
 * Unit tests for lib/data-integrity.ts
 *
 * These are the checks that are supposed to TELL YOU your data is damaged, so a
 * false "clean" here is worse than no check at all. The pool is mocked; what is
 * asserted is the decision each function reaches from a given set of rows, plus
 * that a missing table degrades to a reported non-result rather than throwing.
 *
 * The SQL itself is exercised against a real PostgreSQL 16 instance separately —
 * mocks cannot tell you whether a query parses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({ query: mocks.query }),
}));

import {
  verifyReferentialIntegrity,
  verifyTenantBoundaries,
  verifyAuditChainIntegrity,
  type ForeignKeyRelationship,
  type TenantBoundaryCheck,
} from '@/lib/data-integrity';

/** An `audit_logs` row as the chain walker reads it. */
function entry(id: string, previous: string | null, hash: string) {
  return { id, previous_hash: previous, hash, created_at: new Date() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyReferentialIntegrity', () => {
  const rel: ForeignKeyRelationship = {
    sourceTable: 'invoices',
    sourceColumn: 'quote_id',
    targetTable: 'quotes',
    targetColumn: 'id',
  };

  it('reports clean when no orphans are found', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    const result = await verifyReferentialIntegrity([rel]);

    expect(result.clean).toBe(true);
    expect(result.checked).toBe(1);
    expect(result.violations).toEqual([]);
    expect(() => new Date(result.checkedAt).toISOString()).not.toThrow();
  });

  it('reports the orphaned ids and is NOT clean when orphans exist', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ orphaned_id: 'q-1' }, { orphaned_id: 'q-2' }],
    });

    const result = await verifyReferentialIntegrity([rel]);

    expect(result.clean).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      sourceTable: 'invoices',
      sourceColumn: 'quote_id',
      targetTable: 'quotes',
      targetColumn: 'id',
      orphanedIds: ['q-1', 'q-2'],
      count: 2,
    });
  });

  it('passes the row limit as a bound parameter, not string interpolation', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await verifyReferentialIntegrity([rel], { limit: 7 });

    const [sqlText, params] = mocks.query.mock.calls[0]!;
    expect(params).toEqual([7]);
    expect(sqlText).toContain('LIMIT $1');
    expect(sqlText).not.toContain('LIMIT 7');
  });

  it('checks every supplied relationship', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    const result = await verifyReferentialIntegrity([
      rel,
      { sourceTable: 'orders', sourceColumn: 'quote_id', targetTable: 'quotes', targetColumn: 'id' },
    ]);

    expect(result.checked).toBe(2);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('skips a table that cannot be queried instead of aborting the whole run', async () => {
    // A missing table must not stop the remaining relationships being checked.
    mocks.query
      .mockRejectedValueOnce(new Error('relation "ghost" does not exist'))
      .mockResolvedValueOnce({ rows: [{ orphaned_id: 'q-9' }] });

    const result = await verifyReferentialIntegrity([
      { sourceTable: 'ghost', sourceColumn: 'a', targetTable: 'b', targetColumn: 'id' },
      rel,
    ]);

    expect(result.checked).toBe(2);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.sourceTable).toBe('invoices');
  });

  it('discovers relationships from the catalogue when none are supplied', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            source_table: 'invoices',
            source_column: 'quote_id',
            target_table: 'quotes',
            target_column: 'id',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await verifyReferentialIntegrity();

    expect(result.checked).toBe(1);
    expect(mocks.query.mock.calls[0]![0]).toContain('FOREIGN KEY');
  });

  it('is NOT clean when discovery itself fails', async () => {
    // Returning an empty relationship list would be indistinguishable from
    // "this database has no foreign keys", so a discovery failure must be
    // reported rather than read as health.
    mocks.query.mockRejectedValue(new Error('permission denied for schema information_schema'));

    const result = await verifyReferentialIntegrity();

    expect(result.checked).toBe(0);
    expect(result.clean).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Foreign-key discovery failed');
    expect(result.errors[0]).toContain('permission denied');
  });

  it('is NOT clean when an individual relationship cannot be checked', async () => {
    mocks.query.mockRejectedValue(new Error('relation "ghost" does not exist'));

    const result = await verifyReferentialIntegrity([rel]);

    expect(result.violations).toEqual([]);
    expect(result.clean).toBe(false);
    expect(result.errors[0]).toContain('invoices.quote_id -> quotes.id');
  });
});

describe('verifyTenantBoundaries', () => {
  const check: TenantBoundaryCheck = {
    table: 'tasks',
    foreignColumn: 'contact_id',
    foreignTable: 'contacts',
  };

  it('reports clean when no row references another tenant', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    const result = await verifyTenantBoundaries([check]);

    expect(result.clean).toBe(true);
    expect(result.checked).toBe(1);
  });

  it('flags cross-tenant references as a violation', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ record_id: 't-1', source_tenant: 'tenant-a' }],
    });

    const result = await verifyTenantBoundaries([check]);

    expect(result.clean).toBe(false);
    expect(result.violations[0]).toMatchObject({
      table: 'tasks',
      foreignTable: 'contacts',
      foreignColumn: 'contact_id',
      crossTenantIds: ['t-1'],
      violated: true,
    });
  });

  it('compares tenant_id on both sides of the join', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await verifyTenantBoundaries([check]);

    const sqlText = mocks.query.mock.calls[0]![0] as string;
    expect(sqlText).toContain('s.tenant_id != t.tenant_id');
    // A NULL on either side is not evidence of a leak, so both are excluded.
    expect(sqlText).toContain('s.tenant_id IS NOT NULL');
    expect(sqlText).toContain('t.tenant_id IS NOT NULL');
  });

  it('defaults the foreign target column to id and honours an override', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await verifyTenantBoundaries([check]);
    expect(mocks.query.mock.calls[0]![0]).toContain('t."id"');

    mocks.query.mockClear();
    await verifyTenantBoundaries([{ ...check, foreignTargetColumn: 'contact_uuid' }]);
    expect(mocks.query.mock.calls[0]![0]).toContain('t."contact_uuid"');
  });

  it('passes the sample size as a bound parameter', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await verifyTenantBoundaries([check], { sampleSize: 5 });

    expect(mocks.query.mock.calls[0]![1]).toEqual([5]);
  });

  it('skips an unqueryable table and keeps checking the rest', async () => {
    mocks.query
      .mockRejectedValueOnce(new Error('relation does not exist'))
      .mockResolvedValueOnce({ rows: [{ record_id: 'x' }] });

    const result = await verifyTenantBoundaries([
      { table: 'ghost', foreignColumn: 'a', foreignTable: 'b' },
      check,
    ]);

    expect(result.checked).toBe(2);
    expect(result.violations).toHaveLength(1);
  });

  it('is NOT clean when discovery fails', async () => {
    mocks.query.mockRejectedValue(new Error('nope'));

    const result = await verifyTenantBoundaries();

    expect(result.checked).toBe(0);
    expect(result.clean).toBe(false);
    expect(result.errors[0]).toContain('Tenant-boundary discovery failed');
  });

  it('handles non-Error objects thrown during discovery', async () => {
    mocks.query.mockRejectedValue('string error');
    const result = await verifyTenantBoundaries();
    expect(result.checked).toBe(0);
    expect(result.clean).toBe(false);
    expect(result.errors[0]).toContain('string error');
  });
});

describe('verifyAuditChainIntegrity', () => {
  /** Wire the count query then the chain query. */
  function chain(rows: ReturnType<typeof entry>[], total = rows.length) {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total }] })
      .mockResolvedValueOnce({ rows });
  }

  it('accepts an intact chain', async () => {
    chain([
      entry('1', null, 'h1'),
      entry('2', 'h1', 'h2'),
      entry('3', 'h2', 'h3'),
    ]);

    const result = await verifyAuditChainIntegrity();

    expect(result.clean).toBe(true);
    expect(result.tamperingDetected).toBe(false);
    expect(result.gaps).toEqual([]);
    expect(result.totalRecords).toBe(3);
    expect(result.checkedRecords).toBe(3);
  });

  it('detects a link whose previous_hash does not match the prior record', async () => {
    chain([
      entry('1', null, 'h1'),
      entry('2', 'h1', 'h2'),
      // h2 was expected here: an entry was altered or replaced.
      entry('3', 'FORGED', 'h3'),
    ]);

    const result = await verifyAuditChainIntegrity();

    expect(result.clean).toBe(false);
    expect(result.tamperingDetected).toBe(true);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      id: '3',
      previousHash: 'FORGED',
      currentHash: 'h3',
      gapDetected: true,
      tamperingSuspected: true,
    });
  });

  it('detects a NULL previous_hash appearing mid-chain', async () => {
    // Deleting a record and re-linking, or inserting a forged head, shows up as
    // a null back-pointer on a record that is not the first. Treating null as
    // "nothing to compare" would let exactly that through.
    chain([
      entry('1', null, 'h1'),
      entry('2', null, 'h2'),
    ]);

    const result = await verifyAuditChainIntegrity();

    expect(result.clean).toBe(false);
    expect(result.tamperingDetected).toBe(true);
    expect(result.gaps.map(g => g.id)).toEqual(['2']);
  });

  it('reports every break in a chain, not just the first', async () => {
    chain([
      entry('1', null, 'h1'),
      entry('2', 'WRONG', 'h2'),
      entry('3', 'h2', 'h3'),
      entry('4', 'ALSO-WRONG', 'h4'),
    ]);

    const result = await verifyAuditChainIntegrity();

    expect(result.gaps.map(g => g.id)).toEqual(['2', '4']);
  });

  it('accepts a single-record chain with a null back-pointer', async () => {
    chain([entry('1', null, 'h1')]);

    const result = await verifyAuditChainIntegrity();

    expect(result.clean).toBe(true);
    expect(result.checkedRecords).toBe(1);
  });

  it('accepts an empty audit log', async () => {
    chain([], 0);

    const result = await verifyAuditChainIntegrity();

    expect(result.clean).toBe(true);
    expect(result.totalRecords).toBe(0);
    expect(result.checkedRecords).toBe(0);
  });

  it('reports totalRecords beyond the row limit it actually walked', async () => {
    // So a caller can see the check was partial rather than assuming full cover.
    chain([entry('1', null, 'h1'), entry('2', 'h1', 'h2')], 5000);

    const result = await verifyAuditChainIntegrity({ limit: 2 });

    expect(result.totalRecords).toBe(5000);
    expect(result.checkedRecords).toBe(2);
    expect(mocks.query.mock.calls[1]![1]).toEqual([2]);
  });

  it('orders the walk deterministically so the chain is read in write order', async () => {
    chain([entry('1', null, 'h1')]);

    await verifyAuditChainIntegrity();

    expect(mocks.query.mock.calls[1]![0]).toContain('ORDER BY created_at ASC, id ASC');
  });

  it('honours a custom table name', async () => {
    chain([entry('1', null, 'h1')]);

    await verifyAuditChainIntegrity({ tableName: 'super_admin_audit_logs' });

    expect(mocks.query.mock.calls[0]![0]).toContain('"super_admin_audit_logs"');
  });

  it('is NOT clean when the chain cannot be walked at all', async () => {
    // This previously returned clean: true, so a connection failure and an
    // intact audit chain were indistinguishable — an unverifiable audit log
    // reported as a healthy one.
    mocks.query.mockRejectedValue(new Error('relation "audit_logs" does not exist'));

    const result = await verifyAuditChainIntegrity();

    expect(result.totalRecords).toBe(0);
    expect(result.checkedRecords).toBe(0);
    expect(result.gaps).toEqual([]);
    expect(result.tamperingDetected).toBe(false);
    expect(result.clean).toBe(false);
    expect(result.errors[0]).toContain('Could not walk the audit chain');
    expect(result.errors[0]).toContain('audit_logs');
  });

  it('reports no errors on a successful walk', async () => {
    chain([entry('1', null, 'h1'), entry('2', 'h1', 'h2')]);

    const result = await verifyAuditChainIntegrity();

    expect(result.errors).toEqual([]);
    expect(result.clean).toBe(true);
  });
});
