import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/tenant/admin/ai-templates/[id]/route.ts'), 'utf8');
describe('AI-template writes are tenant- and tombstone-scoped (#3938)', () => {
  it('carries tenant and tombstone predicates on both writes', () => {
    const writes = src.match(/eq\(aiDraftTemplates\.id, id\), eq\(aiDraftTemplates\.tenantId, ctx\.tenantId\), isNull\(aiDraftTemplates\.deletedAt\)/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(2);
  });
  it('has no id-only write left', () => {
    expect(src).not.toContain('.where(eq(aiDraftTemplates.id, id))');
  });
});
