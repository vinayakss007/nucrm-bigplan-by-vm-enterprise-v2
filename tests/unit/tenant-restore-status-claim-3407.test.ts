/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the background backup/restore workers wrote terminal statuses with
 * `WHERE id = ...` only, so a stale worker could overwrite another run's
 * terminal outcome.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/admin/tenant-restore/route.ts'), 'utf8');

describe('#3407: tenant backup/restore terminal writes claim the running from-state', () => {
  it('both backup outcomes claim status=running', () => {
    for (const status of ['completed', 'failed']) {
      const idx = src.indexOf(`status: '${status}',`, src.indexOf('performTenantBackup'));
      expect(idx, status).toBeGreaterThan(-1);
      expect(src.slice(idx, idx + 420), status).toMatch(/eq\(tenantBackupRecords\.status, 'running'\)/);
    }
  });

  it('both restore outcomes claim status=running', () => {
    for (const status of ['completed', 'failed']) {
      const idx = src.indexOf(`status: '${status}',`, src.indexOf('runTenantRestore'));
      expect(idx, status).toBeGreaterThan(-1);
      expect(src.slice(idx, idx + 420), status).toMatch(/eq\(tenantRestoreRecords\.status, 'running'\)/);
    }
  });
});
