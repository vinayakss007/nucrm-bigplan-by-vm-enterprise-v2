/**
 * Tests for lib/db/audit-archival.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { archiveAuditLogs, MemorySink } from '@/lib/db/audit-archival';
import type { DbClient } from '@/drizzle/db';

// Mock DB client
const mockExecute = vi.fn();
const mockDb = { execute: mockExecute } as unknown as DbClient;

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
    // 3. Delete batch
    mockExecute.mockResolvedValueOnce({ rows: [] });

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
    // Delete batch 1
    mockExecute.mockResolvedValueOnce({ rows: [] });
    // Fetch batch 2
    mockExecute.mockResolvedValueOnce({ rows: batch2 });
    // Delete batch 2
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const sink = new MemorySink();
    const result = await archiveAuditLogs(mockDb, sink, { batchSize: 100 });

    expect(result.archivedCount).toBe(150);
    expect(result.batches).toBe(2);
    expect(sink.archives.size).toBe(2);
  });

  it('respects maxRows limit', async () => {
    const batch1 = makeRows(100);

    // Count returns 500 eligible
    mockExecute.mockResolvedValueOnce({ rows: [{ cnt: 500 }] });
    // Fetch batch 1 (capped at maxRows=100)
    mockExecute.mockResolvedValueOnce({ rows: batch1 });
    // Delete batch 1
    mockExecute.mockResolvedValueOnce({ rows: [] });

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
