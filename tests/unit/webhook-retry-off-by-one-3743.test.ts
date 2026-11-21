/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3743 — the retry sweep must include attempt 5: getRetryDelay(5) is a real
 * 24-hour retry, and only the next failure (attempt 6) dead-letters the row.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/webhooks.ts'), 'utf8');

describe('#3743 webhook retry off-by-one', () => {
  it('the retry selector is inclusive of MAX_RETRIES', () => {
    expect(src).toContain('lte(webhookQueue.attempt, MAX_RETRIES)');
    expect(src).not.toMatch(/lt\(webhookQueue\.attempt, MAX_RETRIES\)/);
  });

  it('the writer still dead-letters only AFTER the attempt-5 retry fails', async () => {
    const { getRetryDelay, MAX_RETRIES } = await import('@/lib/webhooks');
    expect(MAX_RETRIES).toBe(5);
    expect(getRetryDelay(MAX_RETRIES)).toBeGreaterThan(0);      // attempt 5 is a real retry
    expect(getRetryDelay(MAX_RETRIES + 1)).toBeLessThan(0);     // attempt 6 dead-letters
  });
});
