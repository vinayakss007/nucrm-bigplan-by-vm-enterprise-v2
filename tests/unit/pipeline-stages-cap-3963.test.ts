import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/tenant/pipelines/[id]/route.ts'), 'utf8');
describe('pipeline stages PATCH is bounded (#3963)', () => {
  it('caps stages at 100 before the write loop', () => {
    expect(src).toContain('incoming.length > 100');
    expect(src.indexOf('incoming.length > 100')).toBeLessThan(src.indexOf('for (const [idx, s] of incoming.entries())'));
  });
});
