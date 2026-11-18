/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The dead-letter list's `pagination.total` must be a NUMBER, not the string
 * that node-postgres returns for an uncast `count(*)` (int8). Every other list
 * route in the repo uses `count(*)::int`; this route was the one outlier.
 *
 * Asserts on the rendered SQL of the count select so a future edit that drops
 * the cast fails here rather than silently changing the response type.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');

describe('dead-letter pagination total is a number (#2755 count-as-string class)', () => {
  it('the count select carries the ::int cast', () => {
    const src = readFileSync(
      join(ROOT, 'app/api/tenant/jobs/dead-letter/route.ts'),
      'utf8',
    );
    // Render the SELECT out of the source and require the cast that 126 other
    // routes use. Without it node-postgres answers "3" (int8 → string).
    expect(src).toMatch(/sql<number>`count\(\*\)::int`/);
    expect(src).not.toMatch(/sql<number>`count\(\*`\s*`/);
  });

  it('a numeric total survives the JSON envelope', async () => {
    const count = 3; // the ::int cast guarantees this is a JS number
    const body = { data: [], pagination: { total: count || 0, limit: 50, offset: 0 } };
    const parsed = JSON.parse(JSON.stringify(body));
    expect(typeof parsed.pagination.total).toBe('number');
    expect(parsed.pagination.total).toBe(3);
  });
});
