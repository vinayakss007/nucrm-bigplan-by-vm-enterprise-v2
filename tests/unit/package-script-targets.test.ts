import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;

describe('package.json script targets', () => {
  it('every scripts/ path named by an npm script exists', () => {
    const missing: string[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      for (const match of command.matchAll(/(?:^|\s)((?:[\w.-]+\/)*scripts\/[^\s'"]+)/g)) {
        const target = (match[1] ?? '').replace(/[);,]+$/, '');
        if (target && !existsSync(join(root, target))) missing.push(`${name}: ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
