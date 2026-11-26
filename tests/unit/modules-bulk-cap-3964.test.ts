import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/superadmin/modules/bulk/route.ts'), 'utf8');
describe('superadmin module bulk is bounded (#3964)', () => {
  it('caps the updates array at 100', () => { expect(src).toContain(').max(100)'); });
});
