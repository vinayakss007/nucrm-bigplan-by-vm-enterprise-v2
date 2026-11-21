/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3739 — the login 429 body's retry_after is a duration in SECONDS, like the
 * Retry-After header and every other limiter in the repo. It used to be minutes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/auth/api-handlers.ts'), 'utf8');

describe('#3739 login retry_after unit', () => {
  it('both brute-force 429 bodies compute retry_after in seconds', () => {
    expect(src.match(/retry_after: Math\.ceil\([\s\S]*?\/ 1000\),/g)).toHaveLength(2);
    expect(src).not.toMatch(/retry_after:[\s\S]{0,200}\/ 1000 \/ 60/);
  });

  it('matches the sibling rate-limit-simple seconds convention', () => {
    const sibling = readFileSync(join(process.cwd(), 'lib/rate-limit-simple.ts'), 'utf8');
    expect(sibling).toContain('Math.ceil((entry.resetAt - now) / 1000)');
  });
});
