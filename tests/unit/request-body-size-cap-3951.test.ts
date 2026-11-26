import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'lib/api/validate.ts'), 'utf8');
describe('request bodies are size-capped (#3951)', () => {
  it('routes readJsonBody through the capped parser', () => {
    expect(src).toContain('MAX_JSON_BODY_BYTES = 1024 * 1024');
    expect(src).toContain('Buffer.byteLength(raw, \'utf8\') > MAX_JSON_BODY_BYTES');
  });
  it('maps a rejected parse to the tagged InvalidJsonBodyError', () => {
    expect(src).toContain('JSON.parse(raw)');
    expect(src).toContain('throw new InvalidJsonBodyError(e);');
  });
});
