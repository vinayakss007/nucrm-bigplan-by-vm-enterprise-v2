import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = '.github/workflows/nightly-soak.yml';
const src = readFileSync(join(process.cwd(), FILE), 'utf8');

function stepAfter(anchor: string): string {
  const start = src.indexOf(anchor);
  expect(start, `${anchor} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\n      - name:', start + anchor.length);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

describe('nightly-soak artifact does not publish sessions (#3844)', () => {
  it('decodes the sessions secret to a known path', () => {
    const write = stepAfter('- name: Write sessions file');
    expect(write).toContain('LOAD_SESSIONS_B64');
    expect(write).toContain('/tmp/sessions.json');
  });

  it('uploads only explicit summary files', () => {
    const upload = stepAfter('- name: Upload summaries');
    expect(upload).toContain('/tmp/baseline.json');
    expect(upload).toContain('/tmp/write-heavy.json');
    expect(upload).not.toContain('/tmp/*.json');
    expect(upload).not.toContain('sessions');
  });

  it('deletes the sessions file before the upload step', () => {
    const removeIdx = src.indexOf('- name: Remove sessions before artifact upload');
    const uploadIdx = src.indexOf('- name: Upload summaries');
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeLessThan(uploadIdx);
    expect(stepAfter('- name: Remove sessions before artifact upload')).toContain('rm -f /tmp/sessions.json');
  });

  it('keeps the k6 runs that consume the sessions file', () => {
    expect(src).toContain('SESSIONS_FILE: /tmp/sessions.json');
    expect(src).toContain('k6 run tests/load/baseline.js');
    expect(src).toContain('k6 run tests/load/write-heavy.js');
  });
});
