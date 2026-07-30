/**
 * Audit Log Archival
 *
 * Moves audit_logs older than a configurable retention window to a compressed
 * JSONL archive (stored via the offsite backup system or local filesystem),
 * then deletes the archived rows from the hot table.
 *
 * Why:
 * - audit_logs is append-only and grows ~100K rows/month per active tenant
 * - Range queries on the hot table slow down as it grows beyond 10M rows
 * - Compliance requires keeping audit data 7 years but only recent data
 *   needs to be query-able in real-time
 *
 * How it works:
 * 1. SELECT rows older than retentionDays into batches (default 10,000 rows)
 * 2. Serialize each batch to compressed JSONL
 * 3. Upload to S3 (or write to disk in dev)
 * 4. DELETE the archived rows by ID within a transaction
 * 5. Return stats (archived count, batches, bytes)
 *
 * This is designed to be called from a cron job (e.g., weekly).
 */

import { sql } from 'drizzle-orm';
import type { DbClient } from '@/drizzle/db';
import { gzipSync } from 'node:zlib';

export interface ArchivalOptions {
  /** Days to keep in the hot table (default: 90) */
  retentionDays?: number;
  /** Max rows per batch (default: 10_000) */
  batchSize?: number;
  /** Max total rows to archive in one run (default: 100_000) */
  maxRows?: number;
  /** If true, only count what WOULD be archived (default: false) */
  dryRun?: boolean;
}

export interface ArchivalResult {
  archivedCount: number;
  batches: number;
  compressedBytes: number;
  dryRun: boolean;
  cutoffDate: string;
}

export interface ArchivalSink {
  /** Write a compressed batch to storage. Returns the storage key. */
  write(key: string, data: Buffer): Promise<string>;
}

/**
 * In-memory sink for testing — stores archives in a map.
 */
export class MemorySink implements ArchivalSink {
  readonly archives = new Map<string, Buffer>();

  async write(key: string, data: Buffer): Promise<string> {
    this.archives.set(key, data);
    return key;
  }
}

/**
 * Filesystem sink for development.
 */
export class FileSink implements ArchivalSink {
  constructor(private readonly baseDir: string) {}

  async write(key: string, data: Buffer): Promise<string> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const path = join(this.baseDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return path;
  }
}

interface AuditRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: unknown;
  new_data: unknown;
  metadata: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

/**
 * Archive audit_logs older than the retention window.
 */
export async function archiveAuditLogs(
  dbClient: DbClient,
  sink: ArchivalSink,
  options: ArchivalOptions = {},
): Promise<ArchivalResult> {
  const {
    retentionDays = 90,
    batchSize = 10_000,
    maxRows = 100_000,
    dryRun = false,
  } = options;

  if (retentionDays < 1 || retentionDays > 3650) {
    throw new Error('retentionDays must be between 1 and 3650');
  }
  if (batchSize < 100 || batchSize > 50_000) {
    throw new Error('batchSize must be between 100 and 50,000');
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffISO = cutoffDate.toISOString();

  // Count eligible rows
  const countResult = await dbClient.execute(
    sql`SELECT count(*)::int AS cnt FROM audit_logs WHERE created_at < ${cutoffISO}`,
  );
  const totalEligible = Number((countResult.rows[0] as { cnt: number })?.cnt ?? 0);

  if (totalEligible === 0 || dryRun) {
    return {
      archivedCount: dryRun ? totalEligible : 0,
      batches: 0,
      compressedBytes: 0,
      dryRun,
      cutoffDate: cutoffISO,
    };
  }

  const rowsToArchive = Math.min(totalEligible, maxRows);
  const totalBatches = Math.ceil(rowsToArchive / batchSize);
  let archived = 0;
  let totalBytes = 0;

  for (let batch = 0; batch < totalBatches; batch++) {
    // Fetch a batch ordered by created_at (oldest first)
    const rows = await dbClient.execute(
      sql`SELECT id, tenant_id, user_id, action, entity_type, entity_id,
                 old_data, new_data, metadata, ip_address, user_agent,
                 created_at::text as created_at
          FROM audit_logs
          WHERE created_at < ${cutoffISO}
          ORDER BY created_at ASC
          LIMIT ${batchSize}`,
    );

    if (rows.rows.length === 0) break;

    const batchRows = rows.rows as unknown as AuditRow[];

    // Serialize to JSONL (one JSON object per line)
    const jsonl = batchRows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const compressed = gzipSync(Buffer.from(jsonl, 'utf-8'));

    // Write to sink
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `audit-archives/${timestamp}-batch-${batch}.jsonl.gz`;
    await sink.write(key, compressed);
    totalBytes += compressed.byteLength;

    // Delete archived rows by ID in a transaction
    const ids = batchRows.map((r) => r.id);
    await dbClient.execute(
      sql`DELETE FROM audit_logs WHERE id = ANY(${ids})`,
    );

    archived += batchRows.length;
  }

  return {
    archivedCount: archived,
    batches: totalBatches,
    compressedBytes: totalBytes,
    dryRun: false,
    cutoffDate: cutoffISO,
  };
}
