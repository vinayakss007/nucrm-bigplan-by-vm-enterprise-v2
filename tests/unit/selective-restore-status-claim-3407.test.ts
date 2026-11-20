/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the selective-restore streaming route wrote each status transition
 * with `WHERE id = <log>` only, so a stale update could overwrite a newer one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/superadmin/selective-restore/execute/route.ts'), 'utf8');

describe('#3407: selective-restore log writes claim their from-state', () => {
  it('pending → running claims pending', () => {
    const idx = src.indexOf("status: 'running',", src.indexOf('.update(selectiveRestoreLogs)'));
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 420)).toMatch(/eq\(selectiveRestoreLogs\.status, 'pending'\)/);
  });

  it('running → completed/failed claims running', () => {
    const idx = src.indexOf("status: result.success ? 'completed' : 'failed',");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 360)).toMatch(/eq\(selectiveRestoreLogs\.status, 'running'\)/);
  });

  it('the catch path only fails a still-open run', () => {
    const idx = src.indexOf("status: 'failed', \n              errorMessage,");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 380)).toMatch(/inArray\(selectiveRestoreLogs\.status, \['pending', 'running'\]\)/);
  });
});
