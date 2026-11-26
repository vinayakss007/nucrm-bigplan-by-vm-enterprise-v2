import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/lead-warming/reply-analyzer.ts'), 'utf8');

describe('ownerNotified reflects a persisted notification (#3925)', () => {
  it('captures the createNotification result', () => {
    expect(src).toContain('const stored = await createNotification(');
  });

  it('only stamps ownerNotified when the notification was stored', () => {
    const storedIdx = src.indexOf('if (stored)');
    const stampIdx = src.indexOf('ownerNotified: true');
    expect(storedIdx).toBeGreaterThanOrEqual(0);
    expect(stampIdx).toBeGreaterThan(storedIdx);
    expect(src).toContain('Lead-warming reply notification was not persisted');
  });
});
