import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/superadmin/plans/[id]/offerings/route.ts'), 'utf8');
describe('plan offerings PUT is bounded (#3962)', () => {
  it('caps offerings at 100 with canonical envelope', () => {
    expect(src).toContain('offerings.length > 100');
    expect(src).toContain("apiFail('BATCH_TOO_LARGE'");
    expect(src.indexOf('offerings.length > 100')).toBeLessThan(src.indexOf('for (const item of offerings)'));
  });
});
