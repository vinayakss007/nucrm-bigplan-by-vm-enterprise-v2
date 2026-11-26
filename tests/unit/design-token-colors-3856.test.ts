import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIRECTORIES = [
  'app/tenant/settings/custom-fields',
  join('app/tenant/forms', '[id]', 'analytics'),
  'app/tenant/settings/compliance',
  'app/tenant/settings/rbac',
  'app/tenant/settings/sso',
  'app/tenant/settings/branding',
];
const FILES = DIRECTORIES.map((dir) => join(dir, 'page.tsx'));

const PAIRS = [
  'text-gray-900 dark:text-gray-100',
  'text-gray-800 dark:text-gray-200',
  'text-gray-700 dark:text-gray-300',
  'text-gray-500 dark:text-gray-400',
  'border-gray-200 dark:border-gray-700',
  'divide-gray-200 dark:divide-gray-700',
  'bg-gray-50 dark:bg-gray-800',
  'bg-white dark:bg-gray-900',
];

describe('themed tenant pages use design tokens (#3856)', () => {
  for (const file of FILES) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    it(`${file} has no hand-rolled light/dark color pairs`, () => {
      for (const pair of PAIRS) expect(src, `${file} still has ${pair}`).not.toContain(pair);
    });
  }

  it('uses foreground, muted, border and card tokens', () => {
    const all = FILES.map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n');
    for (const token of ['text-foreground', 'text-muted-foreground', 'border-border', 'bg-muted', 'bg-card', 'divide-border']) {
      expect(all, `${token} should be in use`).toContain(token);
    }
  });
});
