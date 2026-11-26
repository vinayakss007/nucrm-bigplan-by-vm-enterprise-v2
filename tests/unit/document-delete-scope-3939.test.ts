import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/tenant/documents/[id]/route.ts'), 'utf8');
describe('document soft-delete is tenant- and tombstone-scoped (#3939)', () => {
  it('stamps deletedAt only on a live row in this tenant', () => {
    expect(src).toContain('eq(documents.tenantId, ctx.tenantId), isNull(documents.deletedAt)');
    expect(src).not.toContain('.where(eq(documents.id, id))');
  });
});
