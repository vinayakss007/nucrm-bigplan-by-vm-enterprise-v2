import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseBlameRevs,
  computeDriftDelta,
  applyDriftAllowlist,
} from '../../scripts/check-register-drift.mjs';

/**
 * Unit tests for the register content-drift screen (#2416 follow-up):
 *   - scripts/check-register-drift.mjs        (`npm run guard:register-drift`)
 *   - scripts/register-drift-allowlist.json   the drift that is already known
 *
 * `guard:coords` proves a citation lands on a live line; 24 of the 25 pointers this
 * register has really lost landed on live lines that say something else, so liveness
 * reported "211/216 resolve, exit 0" over every one of them. This screen compares the
 * cited line's CONTENT against the cited file at the revision that wrote the sentence,
 * which needs full history — hence the nightly job in .github/workflows/nightly-soak.yml
 * rather than a `pull_request` gate, where a stacked branch and a rebased one would
 * measure different drift for the same file.
 *
 * The pure function is tested against injected git results, the CLI against a real
 * throwaway repository (deterministic, and the only way to prove the blame parsing and
 * the shallow fail-closed actually work).
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-register-drift.mjs');
const ALLOW = join(ROOT, 'scripts', 'register-drift-allowlist.json');
const REGISTER = join(ROOT, 'docs', 'infra', 'PREPROD-ISSUE-REGISTER.md');

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'drift-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const GIT_AUTHOR = [
  '-c',
  'user.email=guard-test@example.invalid',
  '-c',
  'user.name=guard-test',
];

function git(cwd: string, args: string[]) {
  const res = spawnSync('git', args, { encoding: 'utf8', cwd });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

/**
 * A two-commit repository: commit 1 writes `target.ts` with a line the register cites,
 * commit 2 changes that line and leaves the register alone. Commit 1 is the ROOT commit,
 * so blame reaches it with a boundary caret — the exact header form a first draft of the
 * parser dropped.
 */
function makeRepo(name: string, registerBody: string): string {
  const repo = join(dir, name);
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' });
  writeFileSync(join(repo, 'target.ts'), 'alpha\nthe cited line\ngamma\n');
  writeFileSync(join(repo, 'REG.md'), registerBody);
  git(repo, [...GIT_AUTHOR, 'add', '-A']);
  git(repo, [...GIT_AUTHOR, 'commit', '-q', '-m', 'write the register and the file it cites']);
  return repo;
}

function changeTarget(repo: string, body: string) {
  writeFileSync(join(repo, 'target.ts'), body);
  git(repo, [...GIT_AUTHOR, 'add', '-A']);
  git(repo, [...GIT_AUTHOR, 'commit', '-q', '-m', 'move the cited line under the sentence']);
}

function run(args: string[], cwd: string) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

function allowFixture(name: string, entries: unknown[]): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify({ entries }, null, 2));
  return p;
}

describe('parseBlameRevs', () => {
  const SHA = '65f100ebfe93e84b2094e14c91aa315e21a75607';
  const SHA2 = '0123456789abcdef0123456789abcdef01234567';

  it('maps the final line number when git adds the numLines field', () => {
    const por = [
      `${SHA} 1 1 6`,
      'author someone',
      'filename REG.md',
      '\tthe content line',
      `${SHA2} 2 2`,
      'author someone',
      'filename REG.md',
      '\tsecond line',
    ].join('\n');
    const map = parseBlameRevs(por);
    expect(map.get(1)).toBe(SHA);
    expect(map.get(2)).toBe(SHA2);
  });

  it('accepts the caret that marks a boundary commit', () => {
    // Blame stops at a root commit (or a shallow tip) and prefixes its sha with `^`.
    // Refusing that header loses the citation's authoring revision — measured: 35 of 216
    // pointers on main with a parser anchored to the three-field form.
    const por = [`^${SHA} 1 1 3`, 'author someone', 'filename REG.md', '\ttext'].join('\n');
    expect(parseBlameRevs(por).get(1)).toBe(SHA);
  });

  it('keeps the last header for a line, which is the one that authored it', () => {
    // A moved line gets an interleaved "previous location" header first.
    const por = [
      `${SHA} 40 1`,
      'author someone',
      'filename OLD.md',
      `${SHA2} 7 1`,
      'author someone',
      'filename REG.md',
      '\tmoved here',
    ].join('\n');
    expect(parseBlameRevs(por).get(1)).toBe(SHA2);
  });
});

describe('computeDriftDelta', () => {
  const HEAD = 'a'.repeat(40);
  const OLD = 'b'.repeat(40);

  const inject = (
    lines: string[],
    blame: Map<number, string>,
    files: Record<string, Record<string, string[]>>,
  ) =>
    computeDriftDelta({
      lines,
      blame,
      headSha: HEAD,
      trackedAt: (rev) => Object.keys(files[rev] || {}),
      contentAt: (rev, path) => files[rev]?.[path] ?? null,
    });

  it('calls a pointer whose line content changed moved, with both contents', () => {
    const d = inject(
      ['see target.ts:2 for the claim', ''],
      new Map([[1, OLD]]),
      {
        [HEAD]: { 'target.ts': ['alpha', 'now something else', 'gamma'] },
        [OLD]: { 'target.ts': ['alpha', 'the cited line', 'gamma'] },
      },
    );
    expect(d.moved).toHaveLength(1);
    expect(d.moved[0].cite).toBe('target.ts:2');
    expect(d.moved[0].then).toEqual(['the cited line']);
    expect(d.moved[0].now).toEqual(['now something else']);
    expect(d.same).toBe(0);
  });

  it('counts a pointer that slid onto a blank line as moved, agreeing with guard:coords', () => {
    const d = inject(['see target.ts:2', ''], new Map([[1, OLD]]), {
      [HEAD]: { 'target.ts': ['alpha', '', 'gamma'] },
      [OLD]: { 'target.ts': ['alpha', 'the cited line', 'gamma'] },
    });
    expect(d.moved).toHaveLength(1);
  });

  it('marks a pointer authored by the measured revision as self-authored, not verified', () => {
    // The blind spot, printed instead of hidden: a re-pin PR IS the revision under
    // measurement, so its own pointers compare to themselves. 21 of 201 at c6efdac3.
    const d = inject(['see target.ts:2', ''], new Map([[1, HEAD]]), {
      [HEAD]: { 'target.ts': ['alpha', 'the cited line', 'gamma'] },
    });
    expect(d.same).toBe(1);
    expect(d.selfAuthored).toBe(1);
  });

  it('counts a citation on an uncommitted register line as unchecked, not as unchanged', () => {
    // blame answers a line that is in no commit with 40 zeros. Scoring those as `same`
    // would hand every re-pin PR a green for the pointers it has not written history yet.
    const d = inject(['see target.ts:2', ''], new Map([[1, '0'.repeat(40)]]), {
      [HEAD]: { 'target.ts': ['alpha', 'the cited line', 'gamma'] },
    });
    expect(d.uncommitted).toBe(1);
    expect(d.same).toBe(0);
    expect(d.moved).toHaveLength(0);
  });

  it('separates an untracked prose path from a file that disappeared', () => {
    const d = inject(['next/dist/x.js:10 and gone.ts:2', ''], new Map([[1, OLD]]), {
      [HEAD]: { 'target.ts': ['alpha', 'beta'] },
      [OLD]: { 'gone.ts': ['alpha', 'the cited line'] },
    });
    expect(d.unresolved).toEqual(['next/dist/x.js:10']);
    expect(d.gone).toHaveLength(1);
    expect(d.gone[0].cite).toBe('gone.ts:2');
  });

  it('reports unverifiable rather than drift when line N did not exist when written', () => {
    const d = inject(['see target.ts:900', ''], new Map([[1, OLD]]), {
      [HEAD]: { 'target.ts': ['alpha', 'beta'] },
      [OLD]: { 'target.ts': ['alpha', 'beta'] },
    });
    expect(d.unverifiable).toHaveLength(1);
    expect(d.moved).toHaveLength(0);
  });
});

describe('applyDriftAllowlist', () => {
  const moved = [
    { cite: 'a.ts:1', regLine: 1 },
    { cite: 'b.ts:2', regLine: 2 },
  ];

  it('splits fatal from suppressed and flags entries that no longer drift', () => {
    const r = applyDriftAllowlist(moved, [{ cite: 'b.ts:2', reason: 'PR #1 re-pins it' }]);
    expect(r.fatal.map((x) => x.cite)).toEqual(['a.ts:1']);
    expect(r.suppressed.map((x) => x.cite)).toEqual(['b.ts:2']);
    expect(r.stale).toEqual([]);
  });

  it('reports an allowlisted coordinate that stopped drifting as stale', () => {
    const r = applyDriftAllowlist([], [{ cite: 'z.ts:9', reason: 'gone' }]);
    expect(r.stale).toEqual(['z.ts:9']);
  });
});

describe('the CLI against a real repository', () => {
  it('fails when the cited content is no longer what the sentence was written against', () => {
    const repo = makeRepo('moved', 'The claim lives in target.ts:2.\n');
    changeTarget(repo, 'alpha\nsomething else entirely\ngamma\n');
    const out = run(
      ['--register', 'REG.md', '--allow', allowFixture('allow-empty.json', [])],
      repo,
    );
    expect(out.status).toBe(1);
    expect(out.out).toContain('1 moved');
    expect(out.out).toContain('reg:1  target.ts:2');
    expect(out.out).toContain('the cited line');
    expect(out.out).toContain('something else entirely');
  });

  it('discloses the re-pin blind spot instead of celebrating it', () => {
    const repo = makeRepo('selfauth', 'The claim lives in target.ts:2.\n');
    changeTarget(repo, 'alpha\nsomething else entirely\ngamma\n');
    writeFileSync(join(repo, 'REG.md'), 'The claim lives in target.ts:2 now.\n');
    git(repo, [...GIT_AUTHOR, 'add', '-A']);
    git(repo, [...GIT_AUTHOR, 'commit', '-q', '-m', 're-pin the coordinate']);
    const out = run(['--register', 'REG.md', '--allow', join(dir, 'no-allow.json')], repo);
    expect(out.status).toBe(0);
    // The re-pin passes because the register line's author IS the measured revision, so
    // `then` and `now` are the same tree. Saying "0 moved" without saying that is how a
    // liveness check lied about 24 pointers; this line has to be in the output.
    expect(out.out).toContain('1 of those were written by this very revision');
  });

  it('keeps catching real drift when the register itself carries uncommitted lines', () => {
    // The citations are read off disk, so the blame has to be of those same lines.
    // Blaming HEAD's copy instead maps every later citation to its ABOVE neighbour's
    // authoring revision, and the drift quietly relocates: measured against main, one
    // inserted line turned 10 real drifts into 27 reported ones and lost a real pointer.
    // Here the same mistake turns a genuine drift into nothing at all, which is the
    // false green this file exists to make impossible.
    const repo = makeRepo('shifted', 'The claim lives in target.ts:2.\n');
    changeTarget(repo, 'alpha\nsomething else entirely\ngamma\n');
    writeFileSync(
      join(repo, 'REG.md'),
      'A pointer I have not committed yet: target.ts:1.\nThe claim lives in target.ts:2.\n',
    );
    const out = run(['--register', 'REG.md', '--allow', join(dir, 'no-allow.json')], repo);
    expect(out.out).toContain('reg:2  target.ts:2');
    expect(out.out).toContain('1 on register lines that are not committed yet');
    expect(out.out).not.toContain('OK — no pointer has moved');
    expect(out.status).toBe(1);
  });

  it('suppresses the drift an allowlisted pointer carries, and says so', () => {
    const repo = makeRepo('allowlisted', 'The claim lives in target.ts:2.\n');
    changeTarget(repo, 'alpha\nmoved away\ngamma\n');
    const allow = allowFixture('allow-one.json', [
      { cite: 'target.ts:2', reason: 'PR #9 re-pins this pointer' },
    ]);
    const out = run(['--register', 'REG.md', '--allow', allow], repo);
    expect(out.status).toBe(0);
    expect(out.out).toContain('1 allowlisted');
    expect(out.out).toContain('OK — every drifted pointer is allowlisted');
  });

  it('regenerates one entry per cite and records every register line that points there', () => {
    // An allowlist is maintained with --update, so --update has to write everything a
    // reviewer needs in order to keep the file honest. `applyDriftAllowlist` matches on
    // `cite`, so these two sentences are silenced by one entry — and a regenerated file
    // that dropped the line list would read exactly like one drift, not two.
    const repo = makeRepo('regen', 'The claim lives in target.ts:2.\nAlso see target.ts:2.\n');
    changeTarget(repo, 'alpha\nmoved away\ngamma\n');
    const allow = allowFixture('allow-regen.json', [
      { cite: 'target.ts:2', regLines: [1], reason: 'PR #9 re-pins both sentences' },
    ]);
    const out = run(['--register', 'REG.md', '--allow', allow, '--update'], repo);
    expect(out.status).toBe(0);
    expect(out.out).toContain('allowlist regenerated: 1 entries');
    const written = JSON.parse(readFileSync(allow, 'utf8'));
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0].regLines).toEqual([1, 2]);
    expect(written.entries[0].reason).toBe('PR #9 re-pins both sentences');
  });

  it('fails closed on a shallow checkout instead of reporting no drift', () => {
    const repo = makeRepo('deep', 'The claim lives in target.ts:2.\n');
    changeTarget(repo, 'alpha\nmoved away\ngamma\n');
    const dst = join(dir, 'shallow');
    const clone = spawnSync('git', ['clone', '-q', '--depth', '1', `file://${repo}`, dst], {
      encoding: 'utf8',
    });
    expect(clone.status).toBe(0);
    expect(git(dst, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true');
    const out = run(['--register', 'REG.md', '--allow', join(dir, 'no-allow-2.json')], dst);
    expect(out.status).toBe(1);
    expect(out.out).toContain('this checkout is shallow');
    expect(out.out).toContain('fetch-depth: 0');
    // The false green this guard exists to prevent: depth 1 makes every pointer look
    // self-authored, so a content screen that trusts the tree reports a clean register.
    expect(out.out).not.toContain('OK — every drifted pointer');
  });

  it('fails closed when the register is not where it says it is', () => {
    const repo = makeRepo('missing-reg', 'nothing\n');
    const out = run(['--register', 'NOPE.md', '--allow', join(dir, 'no-allow-3.json')], repo);
    expect(out.status).toBe(1);
    expect(out.out).toContain('failing closed');
  });

  it('rejects an unknown argument with exit 2', () => {
    const repo = makeRepo('badarg', 'nothing\n');
    const out = run(['--frobnicate'], repo);
    expect(out.status).toBe(2);
    expect(out.out).toContain('unknown argument: --frobnicate');
  });
});

describe('the real register against the real tree', () => {
  // Gated on exactly one thing the screen needs — a history it can blame — not on the job.
  // Measured on this PR's own CI run: every throwaway-repo case above passed and this one
  // failed with "this checkout is shallow", because `test-unit` checks out with the default
  // `fetch-depth: 1` while the screen refuses a shallow repo rather than reading a truncated
  // history as agreement. The nightly `register-drift-screen` job fetches `fetch-depth: 0`
  // and is where this assertion gates; on a shallow checkout the case below asserts the
  // refusal instead, so the job still proves something about the screen it cannot otherwise.
  const shallow = git(ROOT, ['rev-parse', '--is-shallow-repository']).trim() === 'true';

  it.runIf(!shallow)('has no un-allowlisted content drift (this is the nightly job\'s assertion)', () => {
    const out = run(['--register', REGISTER, '--allow', ALLOW], ROOT);
    expect(out.out).toContain('OK — every drifted pointer is allowlisted');
    expect(out.status).toBe(0);
  }, 120_000);

  it.runIf(shallow)('fails closed on this shallow checkout instead of reporting agreement', () => {
    const out = run(['--register', REGISTER, '--allow', ALLOW], ROOT);
    expect(out.status).not.toBe(0);
    expect(out.out).toContain('shallow');
  }, 120_000);

  it('carries an allowlist whose entries each have a written, non-placeholder reason', () => {
    const allow = JSON.parse(readFileSync(ALLOW, 'utf8'));
    expect(Array.isArray(allow.entries)).toBe(true);
    expect(allow.entries.length).toBeGreaterThan(0);
    for (const e of allow.entries) {
      expect(e.cite).toMatch(/\.\w+:\d+$/);
      expect(e.reason.length).toBeGreaterThan(20);
      expect(e.reason).not.toMatch(/^TODO/);
      expect(e.reason).toMatch(/#\d+|no open PR|Unowned/);
      // The cite says what drifted; the register lines say which sentence claims it, and
      // without them an entry that silences two pointers is indistinguishable from one.
      expect(Array.isArray(e.regLines)).toBe(true);
      expect(e.regLines.length).toBeGreaterThan(0);
    }
  });

  it('does not let a pointer be allowlisted twice for two register lines', () => {
    // `applyDriftAllowlist` matches on `cite`, so one entry covers every instance. A
    // duplicate would mean the file was generated, not reviewed.
    const allow = JSON.parse(readFileSync(ALLOW, 'utf8'));
    const cites = allow.entries.map((e: { cite: string }) => e.cite);
    expect(new Set(cites).size).toBe(cites.length);
  });

  it('is wired into a scheduled workflow that fetches the history it needs', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'nightly-soak.yml'), 'utf8');
    const job = wf.slice(wf.indexOf('  register-drift-screen:'), wf.indexOf('  soak:'));
    expect(job).toContain('npm run guard:register-drift');
    expect(job).toContain('fetch-depth: 0');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['guard:register-drift']).toContain('check-register-drift');
  });
});
