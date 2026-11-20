/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — scheduled-report delivery wrote `status='active'`/`'error'` with
 * `WHERE id = <report>` only, so a stale run could overwrite an admin's pause.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/cron/scheduled-report-delivery/route.ts'), 'utf8');

describe('#3407: scheduled-report writes claim the active from-state', () => {
  it('both the success and failure writes claim status=active', () => {
    expect(src).toContain("status: 'active',");
    expect(src).toContain("status: giveUp ? 'error' : 'active',");
    expect(src.match(/\.where\(and\(eq\(scheduledReports\.id, report\.id\), eq\(scheduledReports\.status, 'active'\)\)\)/g)).toHaveLength(2);
  });
});
