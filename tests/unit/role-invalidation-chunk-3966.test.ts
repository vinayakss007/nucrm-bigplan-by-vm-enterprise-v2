import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const FILES = [
  'app/api/tenant/roles/[id]/route.ts',
  'app/api/superadmin/tenants/[id]/roles/[roleId]/route.ts',
];
describe('role invalidation is chunked (#3966)', () => {
  for (const file of FILES) {
    it(`${file} invalidates in batches of 50`, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).toContain('+= 50');
      expect(src).not.toMatch(/await Promise\.all\((members|userIds)\.map\(/);
    });
  }
});
