import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/tenant/forms/public/[id]/route.ts'), 'utf8');
describe('anonymous form reads are rate-limited (#3941)', () => {
  it('rate-limits before resolving the form id', () => {
    const limit = src.indexOf('checkRateLimit(');
    const id = src.indexOf('const { id } = await params');
    expect(limit).toBeGreaterThanOrEqual(0);
    expect(limit).toBeLessThan(id);
  });
});
