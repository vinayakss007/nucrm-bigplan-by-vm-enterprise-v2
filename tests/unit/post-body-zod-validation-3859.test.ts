import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS: Array<[string, string[]]> = [
  ['app/api/tenant/record-links/route.ts', ['fromType', 'toId', 'note']],
  ['app/api/tenant/portal/clients/route.ts', ['name', 'email']],
  ['app/api/tenant/ai-keys/route.ts', ['provider', 'api_key', 'base_url']],
  ['app/api/tenant/custom-entities/[id]/rows/route.ts', ['z.object(shape)', 'cleanData']],
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? routeFiles(path) : entry === 'route.ts' ? [path] : [];
  });
}

describe('tenant POST bodies are validated with Zod (#3859)', () => {
  for (const [file, needles] of TARGETS) {
    it(`${file} validates the body before using it`, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).toContain('validateBody(');
      expect(src).toContain("import { z } from 'zod';");
      for (const needle of needles) expect(src, needle).toContain(needle);
      expect(src).not.toMatch(/body as \{/);
    });
  }

  it('does not let unvalidated JSON-reading POST routes accumulate', () => {
    const unvalidated = routeFiles(join(process.cwd(), 'app/api/tenant')).filter((file) => {
      const src = readFileSync(file, 'utf8');
      return src.includes('export const POST') && src.includes('readJsonBody') && !src.includes('validateBody');
    });
    expect(unvalidated.length).toBeLessThanOrEqual(65);
  });

  it('strips undeclared custom-entity fields instead of persisting them', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/tenant/custom-entities/[id]/rows/route.ts'), 'utf8');
    expect(src).toContain('data: cleanData,');
    expect(src).not.toContain('data: rawBody,');
  });
});
