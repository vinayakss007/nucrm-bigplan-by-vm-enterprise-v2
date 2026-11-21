/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/** #3762 — the emails page must read the camelCase dates the tracking route sends. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const page = readFileSync(join(root, 'app/tenant/emails/page.tsx'), 'utf8');
const route = readFileSync(join(root, 'app/api/tenant/email/tracking/route.ts'), 'utf8');

describe('#3762 emails date shape', () => {
  it('the route returns sentAt/createdAt', () => {
    expect(route).toContain('sentAt: emailLog.sentAt');
    expect(route).toContain('createdAt: emailLog.createdAt');
  });

  it('the page renders those fields, so Sent is not "Invalid Date"', () => {
    expect(page).toContain('sentAt?: string;');
    expect(page).toContain('createdAt: string;');
    expect(page).toContain('new Date(e.sentAt || e.createdAt).toLocaleString()');
    expect(page).not.toMatch(/e\.(sent_at|created_at)/);
  });
});
