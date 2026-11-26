import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/public/quotes/[id]/decline/route.ts'), 'utf8');
describe('public quote decline reason is bounded (#3937)', () => {
  it('validates reason with Zod', () => {
    expect(src).toContain("reason: z.string().max(500).optional()");
    expect(src).toContain('validateBody(z.object(');
  });
  it('does not trim an untyped body field', () => {
    expect(src).not.toContain("(body.reason ?? '').trim()");
  });
});
