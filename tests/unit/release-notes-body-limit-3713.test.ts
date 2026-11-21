/**
 * v0.9.1 spans 1,337 commits. GitHub's release API caps the body at 125,000
 * characters, and the first gated release attempt died with HTTP 422
 * "body is too long" after the strict gate had gone green (#3713). The workflow
 * must build a bounded notes file instead of using --generate-notes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const releaseYml = readFileSync(
  join(process.cwd(), '.github/workflows/release.yml'),
  'utf8',
);
const releaseJob = releaseYml.split('\n  release:\n')[1];

describe('release notes body limit (#3713)', () => {
  it('does not use GitHub generated notes for a large range', () => {
    expect(releaseJob).toBeDefined();
    // The explanatory comment names the old flag; only the create args matter.
    expect(releaseJob).not.toMatch(/ARGS=\([^\n]*--generate-notes/);
    expect(releaseJob).toContain('--notes-file');
  });

  it('bounds the subject list instead of dumping the whole history', () => {
    const cap = releaseJob?.match(/git log --no-merges -n (\d+)/)?.[1];
    expect(cap).toBeDefined();
    // 100 subjects of ~90 bytes is ~9 KB, far below the 125 KB API cap.
    expect(Number(cap)).toBeLessThanOrEqual(100);
  });

  it('checks out full history so the previous tag can be found', () => {
    expect(releaseJob).toContain('fetch-depth: 0');
  });
});
