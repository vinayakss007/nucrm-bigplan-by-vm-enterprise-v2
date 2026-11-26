import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/tenant/onboarding/complete/route.ts'), 'utf8');
describe('onboarding module fan-out is capped (#3950)', () => {
  it('validates modules with a max and uniqueness', () => {
    expect(src).toContain('validateBody(z.object({');
    expect(src).toContain("z.array(z.string()).max(50).refine((ids) => new Set(ids).size === ids.length");
  });
  it('still installs best-effort', () => { expect(src).toContain('Promise.allSettled('); });
});
