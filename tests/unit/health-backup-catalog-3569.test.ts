/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3569 — the deep health endpoint's backup check must read the catalog that
 * actually exists. It queried `MAX(created_at) FROM backups`; no `backups`
 * table or view exists and `created_at` is not a column on the catalog, so the
 * query threw on every request and the endpoint reported a permanent
 * `unhealthy` backup section for a reason unrelated to backups.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { backupRecords } from '@/drizzle/schema';

const ROUTE = readFileSync(
  new URL('../../app/api/system/health/route.ts', import.meta.url).pathname,
  'utf8',
);

describe('#3569 the health endpoint reads the real backup catalog', () => {
  it('queries backup_records.completed_at, not the nonexistent backups.created_at', () => {
    expect(ROUTE).toMatch(/SELECT MAX\(completed_at\) AS last_backup FROM backup_records WHERE status = 'completed'/);
    expect(ROUTE).not.toMatch(/FROM backups\b/);
    expect(ROUTE).not.toMatch(/MAX\(created_at\)/);
  });

  it('the catalog and column it now names exist in the schema', () => {
    expect(getTableName(backupRecords)).toBe('backup_records');
    const columns = getTableColumns(backupRecords);
    expect(Object.keys(columns)).toContain('completedAt');
    expect(Object.keys(columns)).toContain('status');
    expect(columns.completedAt!.name).toBe('completed_at');
  });

  it('keeps the response shape the panel and #2542 verdict depend on', () => {
    // The fix changes only the source of `last_backup`; the health response's
    // backup block and its role in the overall verdict are unchanged.
    expect(ROUTE).toMatch(/health\.backup = \{\s*lastBackupTime:/);
    expect(ROUTE).toMatch(/health\.backup\.status/);
  });
});
