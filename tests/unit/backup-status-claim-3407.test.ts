/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the cron backup route wrote `completed` / `failed` with
 * `WHERE id = <backup>` only, so a concurrent terminal write could be
 * overwritten by a stale run's outcome.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/cron/backup/route.ts'), 'utf8');

describe('#3407: backup terminal writes claim the running from-state', () => {
  it('the failure report only moves a still-running row', () => {
    const idx = src.indexOf("status: 'failed',");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 420)).toMatch(/eq\(backupRecords\.status, 'running'\)/);
  });

  it('the success write only moves a still-running row', () => {
    const idx = src.indexOf("status: 'completed',");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 900)).toMatch(/eq\(backupRecords\.status, 'running'\)/);
  });
});
