import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'app/api/tenant/pipelines/[id]/route.ts'), 'utf8');
const start = src.indexOf('export const PATCH');
const patch = src.slice(start, src.indexOf('\nexport const DELETE', start));

describe('pipeline lock failure is surfaced, not swallowed (#3867)', () => {
  it('throws a dedicated error when FOR UPDATE fails', () => {
    expect(src).toContain('class PipelineLockError extends Error');
    expect(patch).toContain('throw new PipelineLockError();');
    expect(patch).not.toMatch(/catch \{\s*\/\/ Lock acquisition failed/);
  });

  it('answers 503 with Retry-After instead of proceeding unguarded', () => {
    expect(patch).toContain('if (err instanceof PipelineLockError)');
    expect(patch).toContain('{ status: 503, headers: { \'Retry-After\': \'1\' } }');
    expect(patch).toContain('retryable: true');
  });

  it('keeps the StageInUseError mapping intact', () => {
    expect(patch).toContain('if (err instanceof StageInUseError)');
  });
});
