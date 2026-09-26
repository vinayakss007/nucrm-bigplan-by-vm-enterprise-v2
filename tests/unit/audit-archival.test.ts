/**
 * Tests for lib/db/audit-archival.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { archiveAuditLogs, MemorySink } from '@/lib/db/audit-archival';
import type { DbClient } from '@/drizzle/db';
import { PgDialect } from 'drizzle-orm/pg-core';

// Mock DB client. Deletion runs inside dbClient.transaction() with the
// migration-0042 purge opt-in GUC, so the mock tx executes on its own spy.
const mockExecute = vi.fn();
const mockTxExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockTransaction = vi.fn(
  async (cb: (tx: { execute: typeof mockTxExecute }) => Promise<unknown>) =>
    cb({ execute: mockTxExecute }),
);
const mockDb = { execute: mockExecute, transaction: mockTransaction } as unknown as DbClient;

function makeRows(count: number, daysOld = 120) {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    action: 'contact.created',
    entity_type: 'contact',
    entity_id: `entity-${i}`,
    old_data: null,
    new_data: { name: `Contact ${i}` },
    metadata: {},
    ip_address: '127.0.0.1',
    user_agent: 'test',
    created_at: new Date(Date.now() - daysOld * 86_400_000).toISOString(),
  }));
}

describe('archiveAuditLogs', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockTxExecute.mockReset();
    mockTxExecute.mockResolvedValue({ rows: [] });
    mockTransaction.mockClear();
  });

  it('returns zero when no rows eligible', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    const sink = new MemorySink();
    const result = await archiveAuditLogs(mockDb, sink);

    expect(result.archivedCount).toBe(0);
    expect(result.batches).toBe(0);
    expect(result.compressedBytes).toBe(0);
    expect(sink.archives.size).toBe(0);
  });

  it('dry run counts but does not delete', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ cnt: 5000 }] });

    const sink = new MemorySink();
    const result = await archiveAuditLogs(mockDb, sink, { dryRun: true });

    expect(result.archivedCount).toBe(5000);
    expect(result.dryRun).toBe(true);
    expect(result.batches).toBe(0);
    expect(sink.archives.size).toBe(0);
    // Only count query, no fetch or delete
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('archives a single batch and deletes rows', async () => {
    const rows = makeRows(50);

    // 1. Count query
    mockExecute.mockResolvedValueOnce({ rows: [{ cnt: 50 }] });
    // 2. Fetch batch
    mockExecute.mockResolvedValueOnce({ rows });

    const sink = new MemorySink();
    const result = await archiveAuditLogs(mockDb, sink, { batchSize: 100 });

    expect(result.archivedCount).toBe(50);
    expect(result.batches).toBe(1);
    expect(result.compressedBytes).toBeGreaterThan(0);
    expect(sink.archives.size).toBe(1);

    // Verify the archive content is valid gzipped JSONL
    const [, buffer] = [...sink.archives.entries()][0]!;
    const decompressed = gunzipSync(buffer).toString('utf-8');
    const lines = decompressed.trim().split('\n');
    expect(lines.length).toBe(50);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.id).toBe('row-0');
    expect(parsed.action).toBe('contact.created');
  });

  it('archives multiple batches when rows exceed batchSize', async () => {
    const batch1 = makeRows(100);
    const batch2 = makeRows(50);

    // Count
    mockExecute.mockResolvedValueOnce({ rows: [{ cnt: 150 }] });
    // Fetch batch 1
    mockExecute.mockResolvedValueOnce({ rows: batch1 });
    // Fetch batch 2
    mockExecute.mockResolvedValueOnce({ rows: batch2 });

    const sink = new MemorySink();
    const result = await archiveAuditLogs(mockDb, sink, { batchSize: 100 });

    expect(result.archivedCount).toBe(150);
    expect(result.batches).toBe(2);
    expect(sink.archives.size).toBe(2);
  });

  it('opts into the migration-0042 purge GUC in the same transaction as each delete (#676)', async () => {
    const rows = makeRows(10);
    // Count
    mockExecute.mockResolvedValueOnce({ rows: [{ cnt: 10 }] });
    // Fetch batch
    mockExecute.mockResolvedValueOnce({ rows });

    const sink = new MemorySink();
    await archiveAuditLogs(mockDb, sink, { batchSize: 100 });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const sqlText = (arg: unknown): string =>
      new PgDialect().sqlToQuery(arg as Parameters<PgDialect['sqlToQuery']>[0]).sql;
    const txSql = mockTxExecute.mock.calls.map((call) => sqlText(call[0]));
    expect(txSql).toHaveLength(2);
    expect(txSql[0]).toContain("SET LOCAL app.allow_audit_purge = 'on'");
    expect(txSql[1]).toContain('DELETE FROM audit_logs');
    // The GUC must be set before the delete — after it, the trigger would
    // already have rejected the batch.
    expect(txSql[0]).not.toContain('DELETE');
    // The delete must NOT run on the un-pinned pool client, where a
    // transaction-scoped GUC cannot reach it.
    expect(mockExecute.mock.calls.map((call) => sqlText(call[0])).join('\n')).not.toContain('DELETE');
  });

  it('respects maxRows limit', async () => {
    const batch1 = makeRows(100);

    // Count returns 500 eligible
    mockExecute.mockResolvedValueOnce({ rows: [{ cnt: 500 }] });
    // Fetch batch 1 (capped at maxRows=100)
    mockExecute.mockResolvedValueOnce({ rows: batch1 });

    const sink = new MemorySink();
    const result = await archiveAuditLogs(mockDb, sink, {
      batchSize: 100,
      maxRows: 100,
    });

    expect(result.archivedCount).toBe(100);
    expect(result.batches).toBe(1);
  });

  it('validates retentionDays bounds', async () => {
    const sink = new MemorySink();

    await expect(
      archiveAuditLogs(mockDb, sink, { retentionDays: 0 }),
    ).rejects.toThrow('retentionDays must be between 1 and 3650');

    await expect(
      archiveAuditLogs(mockDb, sink, { retentionDays: 4000 }),
    ).rejects.toThrow('retentionDays must be between 1 and 3650');
  });

  it('validates batchSize bounds', async () => {
    const sink = new MemorySink();

    await expect(
      archiveAuditLogs(mockDb, sink, { batchSize: 10 }),
    ).rejects.toThrow('batchSize must be between 100 and 50,000');

    await expect(
      archiveAuditLogs(mockDb, sink, { batchSize: 100_000 }),
    ).rejects.toThrow('batchSize must be between 100 and 50,000');
  });

  it('cutoffDate is retentionDays in the past', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    const sink = new MemorySink();
    const before = Date.now();
    const result = await archiveAuditLogs(mockDb, sink, { retentionDays: 30 });

    const cutoff = new Date(result.cutoffDate).getTime();
    const expected = before - 30 * 86_400_000;
    // Within 1 second tolerance
    expect(Math.abs(cutoff - expected)).toBeLessThan(1000);
  });
});
