/**
 * v0.9.1 spans 1,337 commits. GitHub's release API caps the body at 125,000
 * characters, and the first gated release attempt died with HTTP 422
 * "body is too long" after the strict gate had gone green. The workflow must
 * therefore build a bounded notes file instead of using --generate-notes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const releaseYml = readFileSync(
  join(process.cwd(), '.github/workflows/release.yml'),
  'utf8',
);
const releaseJob = releaseYml.split('  release:')[1];

describe('release notes body limit', () => {
  it('does not use GitHub generated notes for a large range', () => {
    expect(releaseJob).toBeDefined();
    expect(releaseJob).not.toMatch(/ARGS=\([^\n]*--generate-notes/);
    expect(releaseJob).toContain('--notes-file');
  });

  it('caps the generated subject list below the 125,000-byte API limit', () => {
    const cap = releaseJob?.match(/head -c (\d+)/)?.[1];
    expect(cap).toBeDefined();
    expect(Number(cap)).toBeLessThan(125000);
  });

  it('checks out full history so the previous tag can be found', () => {
    expect(releaseJob).toContain('fetch-depth: 0');
  });
});
