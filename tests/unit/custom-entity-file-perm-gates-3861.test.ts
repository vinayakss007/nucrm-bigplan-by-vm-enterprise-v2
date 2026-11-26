import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync as readJson } from 'node:fs';

const ROOT = join(process.cwd(), 'app/api/tenant');
const MATRIX = [
  { file: 'custom-entities/[id]/rows/route.ts', handlers: ['POST'], perm: 'settings.manage' },
  { file: 'custom-entities/[id]/rows/[rowId]/route.ts', handlers: ['PATCH', 'DELETE'], perm: 'settings.manage' },
  { file: 'files/route.ts', handlers: ['POST', 'DELETE'], perm: 'documents.manage' },
] as const;

function handlerSource(file: string, method: string): string {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const start = src.indexOf(`export const ${method} = withApiRoute(`);
  expect(start, `${file} ${method} missing`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nexport const ', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

describe('custom-entity rows and file mutations are permission-gated (#3861)', () => {
  for (const row of MATRIX) {
    for (const method of row.handlers) {
      it(`${row.file} ${method} requires ${row.perm} after auth`, () => {
        const body = handlerSource(row.file, method);
        const auth = body.indexOf('const ctx = await requireAuth(');
        const gate = body.indexOf(`requirePerm(ctx, '${row.perm}')`);
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(gate).toBeGreaterThan(auth);
      });
    }
  }

  it('removes the now-gated routes from the shrink-only baseline', () => {
    const baseline = JSON.parse(readJson(join(process.cwd(), 'scripts/mutating-route-permissions-baseline.json'), 'utf8'));
    for (const row of MATRIX) expect(baseline.files).not.toContain(`app/api/tenant/${row.file}`);
  });
});
