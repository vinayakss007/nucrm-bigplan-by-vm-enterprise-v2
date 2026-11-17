/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #2580 Option A — the dead `CSRF_ENFORCE_CENTRAL` backstop is gone.
 *
 * guard:csrf already asserts that proxy.ts still performs the edge double-submit
 * validation the ~290 requireAuth-only routes rest on. What it cannot see is the
 * *other* half of the decision: that no in-handler implementation was left behind
 * an env flag, waiting to be mistaken for coverage again. These assertions pin
 * the removal across the four files that used to mention it.
 */
const ROOT = join(import.meta.dirname!, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const TOUCHED = [
  'lib/auth/middleware.ts',
  '.env.example',
  'scripts/check-csrf-coverage.mjs',
  'tests/integration/oauth-client-registration-3328.test.ts',
];

// Naming the deleted flag in a correction comment is fine — what must be gone is
// any code that reads, sets, or documents it as a live configuration knob.
const WIRING = [
  "process.env['CSRF_ENFORCE_CENTRAL']",
  'process.env.CSRF_ENFORCE_CENTRAL',
  'CSRF_ENFORCE_CENTRAL=',
];

describe('the dead central-CSRF flag is gone (#2580)', () => {
  it.each(TOUCHED)('%s does not wire CSRF_ENFORCE_CENTRAL', (file) => {
    const src = read(file);
    for (const pattern of WIRING) expect(src).not.toContain(pattern);
  });

  it('keeps the explicit requireCsrf() helper for early-exit proxy paths (#2579)', () => {
    expect(read('lib/auth/middleware.ts')).toContain('export function requireCsrf(');
  });

  it('keeps the edge check that is now the only CSRF defense', () => {
    const proxy = read('proxy.ts');
    expect(proxy).toContain('csrf');
    expect(proxy).toContain('validateCsrfToken');
  });
});
