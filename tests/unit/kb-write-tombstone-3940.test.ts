import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/tenant/kb/articles/[id]/route.ts'), 'utf8');
describe('KB article writes skip trashed rows (#3940)', () => {
  it('adds the tombstone predicate to tenant+id writes', () => {
    const scoped = (src.match(/eq\(kbArticles\.tenantId, ctx\.tenantId\), eq\(kbArticles\.id, id\), isNull\(kbArticles\.deletedAt\)/g) ?? []).length;
    expect(scoped).toBeGreaterThanOrEqual(4);
  });
  it('scopes the readback too', () => {
    expect(src).toContain('eq(kbArticles.id, id), eq(kbArticles.tenantId, ctx.tenantId), isNull(kbArticles.deletedAt)');
  });
});
