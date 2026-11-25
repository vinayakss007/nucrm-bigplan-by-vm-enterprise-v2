import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), '.github/workflows');
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const all = files.map((f) => ({ file: f, src: readFileSync(join(DIR, f), 'utf8') }));

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

describe('third-party CI actions and images are pinned (#3852)', () => {
  it('has no mutable action ref outside the official actions/* namespace', () => {
    const offenders: string[] = [];
    for (const { file, src } of all) {
      for (const match of src.matchAll(/uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s]+)/g)) {
        const [, action, ref] = match;
        if (action.startsWith('actions/')) continue;
        if (!SHA.test(ref!)) offenders.push(`${file}: ${action}@${ref}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('pins the deploy SSH action by commit', () => {
    const deploy = all.find((f) => f.file === 'deploy.yml')!.src;
    expect(deploy).toContain('appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2');
    expect(deploy).not.toContain('appleboy/ssh-action@v1');
  });

  it('pins gitleaks and actionlint by digest', () => {
    const ci = all.find((f) => f.file === 'ci.yml')!.src;
    const lint = all.find((f) => f.file === 'workflow-lint.yml')!.src;
    expect(ci).toContain('zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f');
    expect(lint).toContain('rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667');
    expect(ci).not.toContain('gitleaks:latest');
    expect(lint).not.toContain('actionlint:1.7.12');
  });

  it('pins every third-party image reference by digest', () => {
    const offenders: string[] = [];
    for (const { file, src } of all) {
      for (const match of src.matchAll(/image:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+):([^\s]+)/g)) {
        offenders.push(`${file}: ${match[1]}:${match[2]}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(DIGEST.test('sha256:' + 'a'.repeat(64))).toBe(true);
  });
});
