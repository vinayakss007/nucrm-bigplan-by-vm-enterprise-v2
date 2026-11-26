import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/tenant/tax/calculate/route.ts'), 'utf8');
describe('tax calculator fan-out is capped (#3949)', () => {
  it('caps both arrays at 50', () => {
    expect(src).toContain('z.array(z.string().uuid()).max(50).optional()');
    expect(src).toContain('z.array(z.record(z.string(), z.unknown())).max(50).optional()');
  });
});
