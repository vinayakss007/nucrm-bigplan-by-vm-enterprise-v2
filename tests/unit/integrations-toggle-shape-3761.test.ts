/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/** #3761 — the integrations page must read isActive/createdAt from the route. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const page = readFileSync(join(root, 'app/tenant/settings/integrations/page.tsx'), 'utf8');
const route = readFileSync(join(root, 'app/api/tenant/integrations/route.ts'), 'utf8');

describe('#3761 integrations toggle shape', () => {
  it('the route spreads the raw row (camelCase)', () => {
    expect(route).toMatch(/maskIntegration[\s\S]{0,400}\.\.\.row|\.\.\.integration/);
  });

  it('the page reads and toggles the camelCase fields', () => {
    expect(page).toContain('createdAt: string;');
    expect(page).toContain('isActive: boolean;');
    expect(page).toContain('formatDate(i.createdAt)');
    expect(page).toContain('toggle(i.id,i.isActive)');
    expect(page).toContain('i.isActive?');
    expect(page).not.toMatch(/i\.(is_active|created_at)/);
  });
});
