/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the async backup parser wrote `completed` / `failed` with
 * `WHERE id = <backup>` only, so a stale parse could overwrite a newer result.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/superadmin/selective-restore/backups/route.ts'), 'utf8');

describe('#3407: backup parse terminal writes claim the pending from-state', () => {
  it('both outcomes claim status=pending', () => {
    for (const status of ['completed', 'failed']) {
      const idx = src.indexOf(`status: '${status}'`, src.indexOf('parseBackupAsync'));
      expect(idx, status).toBeGreaterThan(-1);
      expect(src.slice(idx, idx + 420), status).toMatch(/eq\(superAdminBackups\.status, 'pending'\)/);
    }
  });
});
