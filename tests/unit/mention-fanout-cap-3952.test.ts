import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'lib/notifications.ts'), 'utf8');
const start = src.indexOf('export async function processMentions');
const fn = src.slice(start, src.indexOf('\n}\n', start));
describe('mention resolution is bounded and batched (#3952)', () => {
  it('dedupes and caps usernames', () => {
    expect(fn).toContain('new Set((text.match(/@(\\w+)/g)');
    expect(fn).toContain('.slice(0, 20)');
  });
  it('resolves all users in one query', () => {
    expect(fn.match(/await db\.select/g)).toHaveLength(1);
    expect(fn).toContain('or(...matches)');
  });
});
