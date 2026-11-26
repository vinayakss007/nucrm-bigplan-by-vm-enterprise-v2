import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'lib/history.ts'), 'utf8');
describe('history snapshots are bounded (#3953)', () => {
  it('takes a limit and applies it to the query', () => {
    expect(src).toContain('limit = 200');
    expect(src).toContain('.limit(limit)');
  });
});
