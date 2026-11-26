import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'lib/api/schemas/admin.ts'), 'utf8');
describe('admin tag merge is bounded (#3965)', () => {
  it('caps the tags array at 20', () => {
    const line = src.split('\n').find(l => l.includes('tags: z.array'));
    expect(line).toContain('.max(20)');
  });
});
