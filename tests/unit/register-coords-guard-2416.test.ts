import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractCitations,
  resolvePath,
  computeCoordDelta,
  applyAllowlist,
  extractCommentCitations,
} from '../../scripts/check-register-coords.mjs';

/**
 * Unit tests for the register-coordinate guard (#2416 follow-up):
 *   - scripts/check-register-coords.mjs          (`npm run guard:coords`)
 *   - scripts/register-coords-allowlist.json     known-drift ratchet
 *
 * The guard exists because `path:line` citations in
 * docs/infra/PREPROD-ISSUE-REGISTER.md drift silently when the cited file moves —
 * PP-058 cited `deploy.yml:298` for weeks after #2404 made that line blank. Tests
 * here run the CLI against real tracked files (exactly how CI does), so they assert
 * exit codes and report text rather than internals.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-register-coords.mjs');
const ALLOW = join(ROOT, 'scripts', 'register-coords-allowlist.json');
const REGISTER = join(ROOT, 'docs', 'infra', 'PREPROD-ISSUE-REGISTER.md');

/** A tracked file we know has both blank and non-blank lines. */
const TARGET = '.github/workflows/ci.yml';

let dir: string;
let targetLines: string[];
let blankAt = 0;
let liveAt = 0;
let liveAt2 = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'coords-'));
  targetLines = readFileSync(join(ROOT, TARGET), 'utf8').split('\n');
  blankAt = targetLines.findIndex((l) => l.trim() === '') + 1;
  const live = targetLines
    .map((l, i) => (l.trim() === '' ? 0 : i + 1))
    .filter((n) => n > 0)
    .slice(0, 2);
  liveAt = live[0] ?? 0;
  liveAt2 = live[1] ?? 0;
  expect(blankAt).toBeGreaterThan(0);
  expect(liveAt2).toBeGreaterThan(0);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function reg(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

function allowFixture(name: string, entries: unknown[]): string {
  return reg(name, JSON.stringify({ entries }, null, 2));
}

function run(args: string[]) {
  // spawnSync with an argv array (no shell), cwd = repo root so `git ls-files`
  // and relative reads see the same tree CI checks out.
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: ROOT });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

describe('check-register-coords.mjs — CLI', () => {
  it('passes when every citation lands on a non-blank line', () => {
    const r = reg('clean.md', `see ${TARGET}:${liveAt} and ${TARGET}:${liveAt2}\n`);
    const out = run(['--register', r, '--allow', allowFixture('allow-empty.json', [])]);
    expect(out.out).toContain('OK — no drifted coordinates');
    expect(out.status).toBe(0);
  });

  it('fails, naming the citation and the register line, when the target is blank', () => {
    const r = reg('blank.md', `prose ${TARGET}:${blankAt} prose\n`);
    const out = run(['--register', r, '--allow', allowFixture('allow-empty2.json', [])]);
    expect(out.status).toBe(1);
    expect(out.out).toContain(`${TARGET}:${blankAt}`);
    expect(out.out).toContain('is BLANK');
    expect(out.out).toContain('reg:1');
    expect(out.out).toContain('guard failed');
  });

  it('fails on an out-of-range line number', () => {
    const n = targetLines.length + 500;
    const r = reg('range.md', `see ${TARGET}:${n}\n`);
    const out = run(['--register', r, '--allow', allowFixture('allow-empty3.json', [])]);
    expect(out.status).toBe(1);
    expect(out.out).toContain('out of range');
  });

  it('skips a citation whose path matches no tracked file (vendored / generated paths)', () => {
    const r = reg(
      'vendored.md',
      'next/dist/server/lib/start-server.js:389 and build/cjs/client/index.js:37 are not ours\n',
    );
    const out = run(['--register', r, '--allow', allowFixture('allow-empty4.json', [])]);
    expect(out.status).toBe(0);
    expect(out.out).toContain('0/2 citations resolve');
    expect(out.out).toContain('2 unmatchable prose path(s) skipped');
  });

  it('FAILS CLOSED when the register is missing — an absent doc is not a verified doc', () => {
    const out = run(['--register', join(dir, 'nope.md'), '--allow', ALLOW]);
    expect(out.status).toBe(1);
    expect(out.out).toContain('failing closed');
  });

  it('suppresses drift that the allowlist carries, and says so in the tally', () => {
    const r = reg('allowed.md', `prose ${TARGET}:${blankAt} prose\n`);
    const a = allowFixture('allow-one.json', [
      { cite: `${TARGET}:${blankAt}`, reason: 'test-only drift' },
    ]);
    const out = run(['--register', r, '--allow', a]);
    expect(out.status).toBe(0);
    expect(out.out).toContain('1 allowlisted');
    expect(out.out).not.toContain('guard failed');
  });

  it('warns (non-failing) when an allowlist entry no longer drifts', () => {
    const r = reg('clean2.md', `see ${TARGET}:${liveAt}\n`);
    const a = allowFixture('allow-stale.json', [
      { cite: `${TARGET}:${blankAt}`, reason: 'already corrected, entry left behind' },
    ]);
    const out = run(['--register', r, '--allow', a]);
    expect(out.status).toBe(0);
    expect(out.out).toContain('NOTE (non-failing)');
    expect(out.out).toContain(`${TARGET}:${blankAt}`);
  });

  it('rejects an unknown argument rather than silently ignoring it', () => {
    const out = run(['--register', ALLOW, '--frobnicate']);
    expect(out.status).toBe(2);
    expect(out.out).toContain('unknown argument');
  });
});

describe('check-register-coords.mjs — citation extraction', () => {
  it('reads bracketed route paths as one citation, not a fragment', () => {
    const found = extractCitations(['app/api/tickets/[id]/route.ts:139 opens a ticket']).map(
      (c) => c.cite,
    );
    expect(found).toEqual(['app/api/tickets/[id]/route.ts:139']);
  });

  it('does not read a colon inside prose that has no file extension', () => {
    expect(extractCitations(['deployed at 2026-10-06T11:25:44Z, see note 7:12'])).toEqual([]);
  });

  it('records which register line each citation came from', () => {
    const found = extractCitations(['nothing', `see ${TARGET}:14 here`]);
    expect(found).toHaveLength(1);
    expect(found[0].regLine).toBe(2);
  });
});

describe('check-register-coords.mjs — citations minted inside comments', () => {
  it('fails a comment that mints a citation, and does not call it drift', () => {
    const r = reg('comment.md', `<!-- correction: see ${TARGET}:${liveAt} -->\n`);
    const out = run(['--register', r, '--allow', allowFixture('allow-c1.json', [])]);
    expect(out.status).toBe(1);
    expect(out.out).toContain('comment guard failed');
    expect(out.out).toContain(`${TARGET}:${liveAt}`);
    expect(out.out).toContain('1 minted inside a comment');
    // The line IS live — which is exactly why liveness alone cannot see this.
    expect(out.out).not.toContain('BLANK');
    expect(out.out).not.toContain('out of range');
  });

  it('does not fail a citation that follows the closing --> on the same line', () => {
    const r = reg('boundary.md', `<!-- note --> body text ${TARGET}:${liveAt} here\n`);
    const out = run(['--register', r, '--allow', allowFixture('allow-c2.json', [])]);
    expect(out.status).toBe(0);
    expect(out.out).toContain('OK — no drifted coordinates');
  });

  it('does fail the same line when the token comes BEFORE the -->', () => {
    const r = reg('boundary2.md', `<!-- note body text ${TARGET}:${liveAt} -->\n`);
    const out = run(['--register', r, '--allow', allowFixture('allow-c3.json', [])]);
    expect(out.status).toBe(1);
    expect(out.out).toContain('comment guard failed');
  });

  it('reads the register convention — bare numbers in a comment — as nothing', () => {
    const body = '<!-- coordinate corrections: infra 148 → 159, migrate 210 → 129, route 44-46 → 52-54 -->\n';
    expect(extractCommentCitations(body.split('\n'))).toEqual([]);
    const out = run(['--register', reg('prose.md', body), '--allow', allowFixture('allow-c4.json', [])]);
    expect(out.status).toBe(0);
  });

  it('treats an unterminated <!-- as comment all the way to end of file', () => {
    const r = reg(
      'open.md',
      `prose ${TARGET}:${liveAt}\n<!-- never closed\nmore prose ${TARGET}:${liveAt2}\n`,
    );
    const out = run(['--register', r, '--allow', allowFixture('allow-c5.json', [])]);
    expect(out.status).toBe(1);
    expect(out.out).toContain('reg:3');
    expect(out.out).not.toContain('reg:1');
  });

  it('counts comment-minted tokens in the total the guard resolves — the reason to fail', () => {
    const body = [`prose ${TARGET}:${liveAt}`, `<!-- see ${TARGET}:${liveAt2} -->`];
    expect(extractCitations(body)).toHaveLength(2);
    expect(extractCommentCitations(body).map((c) => c.cite)).toEqual([`${TARGET}:${liveAt2}`]);
  });
});

describe('check-register-coords.mjs — resolution rules', () => {
  const tracked = ['lib/db/pool.ts', 'src/lib/db/pool.ts', 'app/api/x/[id]/route.ts'];
  const files: Record<string, string> = {
    'lib/db/pool.ts': 'a\n\nb\n', // line 2 blank
    'src/lib/db/pool.ts': 'a\nb\nc\n', // no blank lines
    'app/api/x/[id]/route.ts': 'x\ny\n',
  };
  const readFile = (p: string) => files[p] ?? null;

  it('resolves a bare filename by suffix against the tracked tree', () => {
    expect(resolvePath(tracked, 'pool.ts')).toEqual(['lib/db/pool.ts', 'src/lib/db/pool.ts']);
    expect(resolvePath(tracked, 'lib/db/pool.ts')).toEqual(['lib/db/pool.ts']);
    expect(resolvePath(tracked, 'nope.ts')).toEqual([]);
  });

  it('passes when ANY candidate is live — a blank twin is not a drift', () => {
    const d = computeCoordDelta({
      lines: ['see pool.ts:2'],
      tracked,
      readFile,
    });
    expect(d.drifted).toEqual([]);
    expect(d.checked).toBe(1);
  });

  it('drifts when EVERY candidate is blank or out of range, and explains each', () => {
    const d = computeCoordDelta({
      lines: ['see lib/db/pool.ts:2'],
      tracked,
      readFile,
    });
    expect(d.drifted).toHaveLength(1);
    expect(d.drifted[0].cite).toBe('lib/db/pool.ts:2');
    expect(d.drifted[0].why).toContain('lib/db/pool.ts:2 is BLANK');
  });

  it('reports a tracked file that is absent from the working tree', () => {
    const d = computeCoordDelta({
      lines: ['see gone.ts:1'],
      tracked: [...tracked, 'gone.ts'],
      readFile,
    });
    expect(d.drifted[0].why).toContain('not in the working tree');
  });

  it('separates fatal drift from allowed drift and finds stale allowlist keys', () => {
    const drift = (cite: string, regLine: number) => ({
      cite,
      regLine,
      path: cite.split(':')[0],
      n: Number(cite.split(':')[1]),
      why: 'test',
    });
    const drifted = [drift('a.ts:1', 1), drift('b.ts:2', 2)];
    const r = applyAllowlist(drifted, [{ cite: 'b.ts:2', reason: 'waiting on a PR' }]);
    expect(r.fatal.map((d: { cite: string }) => d.cite)).toEqual(['a.ts:1']);
    expect(r.suppressed.map((d: { cite: string }) => d.cite)).toEqual(['b.ts:2']);
    expect(applyAllowlist(drifted, [{ cite: 'z.ts:9', reason: 'gone' }]).stale).toEqual(['z.ts:9']);
  });
});

describe('the real register against the real allowlist', () => {
  it('has no drifted citation outside the allowlist (this fails the moment ci.yml or a cited file moves)', () => {
    const out = run([]);
    expect(out.out).toContain('OK — no drifted coordinates');
    expect(out.status).toBe(0);
  });

  it('carries an allowlist whose entries each have a written, non-placeholder reason', () => {
    const allow = JSON.parse(readFileSync(ALLOW, 'utf8'));
    expect(Array.isArray(allow.entries)).toBe(true);
    expect(allow.entries.length).toBeLessThanOrEqual(3);
    for (const e of allow.entries) {
      expect(typeof e.cite).toBe('string');
      expect(e.reason.length).toBeGreaterThan(40);
      expect(e.reason).not.toMatch(/^TODO/);
    }
  });

  it('mints no citation inside an HTML comment — corrections are recorded as prose', () => {
    const lines = readFileSync(REGISTER, 'utf8').split('\n');
    expect(extractCommentCitations(lines)).toEqual([]);
    // Floor, not an exact count: the resolved total must stay large, and a non-empty
    // comment set above would mean part of it was never an assertion about a file.
    expect(extractCitations(lines).length).toBeGreaterThan(200);
  });
});
