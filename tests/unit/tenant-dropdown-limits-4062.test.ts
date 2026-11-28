import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DROPDOWN_LIMIT } from '@/lib/api/query-params';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('tenant list dropdown reads are capped (#4062)', () => {
  it('uses a shared cap of 50', () => {
    expect(DROPDOWN_LIMIT).toBe(50);
  });

  it.each([
    ['app/tenant/contacts/page.tsx', 2],
    ['app/tenant/deals/page.tsx', 3],
    ['app/tenant/tasks/page.tsx', 3],
  ])('%s caps every dropdown read', (path, expected) => {
    const src = read(path);
    expect(src).toContain("import { DROPDOWN_LIMIT } from '@/lib/api/query-params'");
    expect(src.split('DROPDOWN_LIMIT').length - 1).toBe(expected + 1);
    expect(src).not.toMatch(/db\.query\.(companies|contacts|deals)\.findMany\(\{[^}]*\}\)/s);
  });
});
