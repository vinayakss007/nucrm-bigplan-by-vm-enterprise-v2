import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = [
  'app/api/superadmin/backups/route.ts',
  'app/api/superadmin/selective-restore/backups/route.ts',
];

describe('superadmin backup reads surface failures (#3923)', () => {
  for (const file of FILES) {
    it(`${file} has no .catch returning an empty fallback`, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src, `${file} still masks a failed read`).not.toMatch(/\.catch\(\(err\) => \{ void logError\([^)]*\); return /);
    });
  }

  it('both handlers still route errors through their outer catch/apiError', () => {
    for (const file of FILES) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src, file).toContain('return apiError(err)');
    }
  });
});
