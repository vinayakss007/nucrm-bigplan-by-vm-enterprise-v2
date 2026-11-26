import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/public/csat/[token]/route.ts'), 'utf8');
describe('CSAT responses are bounded (#3936)', () => {
  it('validates score and comment with Zod before the write', () => {
    expect(src).toContain("comment: z.string().max(2000).optional()");
    expect(src).toContain('validateBody(z.object({');
    expect(src.indexOf('validateBody(')).toBeLessThan(src.indexOf('.update(csatSurveys)'));
  });
  it('no longer reads untyped fields or checks score by hand', () => {
    expect(src).not.toContain('const { score, comment } = body;');
    expect(src).not.toContain("typeof score !== 'number'");
  });
});
