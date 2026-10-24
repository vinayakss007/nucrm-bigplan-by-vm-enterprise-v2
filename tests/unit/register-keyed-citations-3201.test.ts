import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CITE_RE,
  extractCitations,
  resolvePath,
  resolveJsonKey,
  computeCoordDelta,
  applyAllowlist,
  canonicalCite,
  makeCitation,
  extractCommentCitations,
} from '../../scripts/check-register-coords.mjs';
import {
  computeDriftDelta,
  applyDriftAllowlist,
} from '../../scripts/check-register-drift.mjs';

/**
 * Tests for keyed register citations (#3201).
 *
 * `docs/infra/PREPROD-ISSUE-REGISTER.md` cited `package.json:110` for the `db:drift-check`
 * alias. When **#3178** added one unrelated script line at `:65`, that pointer — and five
 * siblings — moved onto the line below without the fact they describe changing at all.
 * #3198 re-pinned all six by hand; this file tests the format change that makes the class
 * stop recurring: `package.json:"db:drift-check"` names the key, and both guards compare
 * the VALUE of that key instead of the text of whatever line happens to sit at N.
 *
 * The claim under test is narrow and the cases are written to falsify it:
 *   - an insertion ABOVE the key is invisible to both guards (that is the whole point);
 *   - renaming or deleting the key fails loudly in both, not "unverifiable";
 *   - an ambiguous key name is a failure, not a coin flip;
 *   - positional citations still behave exactly as they did, including the allowlists,
 *     which stay form-sensitive so a stale `path:N` entry cannot hush a `path:"key"` one.
 *
 * No live host, URL or credential appears anywhere here: the throwaway repository holds a
 * `package.json` fixture whose only scripts are `echo` calls.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const COORDS = join(ROOT, 'scripts', 'check-register-coords.mjs');
const DRIFT = join(ROOT, 'scripts', 'check-register-drift.mjs');
const REGISTER = join(ROOT, 'docs', 'infra', 'PREPROD-ISSUE-REGISTER.md');

const KEYED_JSON = '{\n  "name": "nucrm-fixture",\n  "scripts": {\n    "a:one": "echo one",\n    "db:drift-check": "npx tsx scripts/drift-check.ts"\n  }\n}\n';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'keyed-3201-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const GIT_AUTHOR = ['-c', 'user.email=guard-test@example.invalid', '-c', 'user.name=guard-test'];

function git(cwd: string, args: string[]) {
  const res = spawnSync('git', args, { encoding: 'utf8', cwd });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function run(script: string, args: string[], cwd: string) {
  const res = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

/**
 * A real two-commit repo: `package.json` as above (so `db:drift-check` sits at `:5`), and a
 * register carrying BOTH forms of the same pointer plus one positional pointer to the line
 * above it. Commit 2 inserts a script line at `:4`, pushing every line below down by one and
 * changing nothing about any value.
 */
function makeKeyedRepo(name: string, registerBody: string) {
  const repo = join(dir, name);
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' });
  writeFileSync(join(repo, 'package.json'), KEYED_JSON);
  writeFileSync(join(repo, 'REG.md'), registerBody);
  git(repo, [...GIT_AUTHOR, 'add', '-A']);
  git(repo, [...GIT_AUTHOR, 'commit', '-q', '-m', 'write the register and the package.json it cites']);
  return repo;
}

function insertScriptLineAboveDriftCheck(repo: string) {
  writeFileSync(
    join(repo, 'package.json'),
    KEYED_JSON.replace('"a:one"', '"zz:unrelated": "echo inserted",\n    "a:one"'),
  );
  git(repo, [...GIT_AUTHOR, 'add', '-A']);
  git(repo, [...GIT_AUTHOR, 'commit', '-q', '-m', 'an unrelated script line, added above the cited key']);
}

describe('CITE_RE and extractCitations — the two forms', () => {
  it('reads a quoted JSON key as one keyed citation', () => {
    const found = extractCitations(['the alias is `package.json:"db:drift-check"` now']);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      regLine: 1,
      path: 'package.json',
      n: null,
      key: 'db:drift-check',
      kind: 'key',
      cite: 'package.json:"db:drift-check"',
    });
  });

  it('still reads `path:N` positionally, with the same fields it carried before #3201', () => {
    const found = extractCitations(['the alias is `package.json:110` now']);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('line');
    expect(found[0].n).toBe(110);
    expect(found[0].key).toBe(null);
    expect(found[0].cite).toBe('package.json:110');
  });

  it('takes both forms out of one sentence, in order', () => {
    const found = extractCitations(['was `package.json:110`, now `package.json:"db:drift-check"`']);
    expect(found.map((c: { cite: string }) => c.cite)).toEqual([
      'package.json:110',
      'package.json:"db:drift-check"',
    ]);
  });

  it('will not borrow a key across a line break, nor accept an empty one', () => {
    expect(extractCitations(['package.json:', '"db:drift-check" between two sentences'])).toEqual([]);
    expect(extractCitations(['see package.json:""'])).toEqual([]);
  });

  it('does not treat a bare key name, with no file in front of it, as a citation', () => {
    expect(extractCitations(['run `npm run "db:drift-check"` and note 7:12'])).toEqual([]);
  });

  it('keeps the regex a single alternation so a number is never parsed as a key', () => {
    expect(CITE_RE.source).toContain('(?:(\\d+)|');
    expect(makeCitation(3, 'package.json', '110', undefined).cite).toBe('package.json:110');
    expect(makeCitation(3, 'package.json', undefined, 'db:drift-check').kind).toBe('key');
  });
});

describe('resolveJsonKey — the keyed resolver', () => {
  const doc = () =>
    JSON.stringify({ name: 'fixture', scripts: { 'db:drift-check': 'npx tsx scripts/drift-check.ts' } });

  it('returns the value of the key the pointer names', () => {
    const r = resolveJsonKey(doc(), 'package.json', 'db:drift-check');
    expect(r.ok).toBe(true);
    expect(r.status).toBe('ok');
    expect(r.value).toBe('npx tsx scripts/drift-check.ts');
  });

  it('fails a key that is not there, in words a reviewer can act on', () => {
    const r = resolveJsonKey(doc(), 'package.json', 'db:drift-chek');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('missing');
    expect(r.detail).toContain('has no "db:drift-chek" key');
  });

  it('fails an ambiguous key rather than guessing which occurrence was meant', () => {
    // Two objects, each holding the key — a real shape in a manifest, and one a spread
    // inside a single object literal cannot express because JSON.parse keeps the last pair.
    const dup = JSON.stringify({ scripts: { 'db:drift-check': 'npx tsx scripts/drift-check.ts' }, other: { 'db:drift-check': 'echo somewhere-else' } });
    const r = resolveJsonKey(dup, 'package.json', 'db:drift-check');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('ambiguous');
    expect(r.detail).toContain('appears 2 times');
  });

  it('finds a key at any depth, and stringifies a non-string value whole', () => {
    const nested = JSON.stringify({ a: { b: { c: [1, { d: 'x' }] } } });
    expect(resolveJsonKey(nested, 'x.json', 'd').value).toBe('x');
    expect(resolveJsonKey(nested, 'x.json', 'b').value).toBe('{"c":[1,{"d":"x"}]}');
  });

  it('refuses a non-JSON file instead of silently skipping the pointer', () => {
    const r = resolveJsonKey('export const a = 1;\n', 'lib/a.ts', 'a');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('not-json');
    expect(r.detail).toContain('is not a .json file');
  });

  it('refuses a file that does not parse, quoting the parser', () => {
    const r = resolveJsonKey('{"scripts": ', 'package.json', 'scripts');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('parse-error');
  });
});

describe('resolvePath — a keyed pointer asks a JSON file', () => {
  const tracked = ['lib/db/pool.json', 'lib/db/pool.ts', 'package.json'];

  it('narrows to the keyed-citable twin, and only for a keyed citation', () => {
    expect(resolvePath(tracked, 'lib/db/pool.ts', 'key')).toEqual(['lib/db/pool.ts']);
    expect(resolvePath(tracked, 'pool.json', 'key')).toEqual(['lib/db/pool.json']);
    expect(resolvePath(tracked, 'pool.ts')).toEqual(['lib/db/pool.ts']);
  });

  it('hands back a non-JSON candidate anyway when nothing else matches, so the guard fails it out loud', () => {
    expect(resolvePath(['weird.ts'], 'weird.ts', 'key')).toEqual(['weird.ts']);
  });

  it('is unchanged for positional citations', () => {
    expect(resolvePath(['lib/db/pool.ts', 'src/lib/db/pool.ts'], 'pool.ts', 'line')).toEqual([
      'lib/db/pool.ts',
      'src/lib/db/pool.ts',
    ]);
  });
});

describe('computeCoordDelta — liveness of a key', () => {
  const tracked = ['package.json', 'lib/a.ts'];
  const readFile = (p: string) => (p === 'package.json' ? KEYED_JSON : p === 'lib/a.ts' ? 'x\n' : null);

  it('counts a keyed pointer as checked, in the same totals a positional one used', () => {
    const d = computeCoordDelta({ lines: ['the alias is package.json:"db:drift-check".'], tracked, readFile });
    expect(d.total).toBe(1);
    expect(d.checked).toBe(1);
    expect(d.keyed).toBe(1);
    expect(d.drifted).toEqual([]);
  });

  it('drifts when the key is renamed or deleted, and says so', () => {
    const d = computeCoordDelta({ lines: ['package.json:"db:drift-chek"'], tracked, readFile });
    expect(d.drifted).toHaveLength(1);
    expect(d.drifted[0].cite).toBe('package.json:"db:drift-chek"');
    expect(d.drifted[0].why).toContain('has no "db:drift-chek" key');
  });

  it('does NOT drift when an unrelated script line moves the key down — that is the claim', () => {
    const moved = KEYED_JSON.replace('"a:one"', '"zz:new": "echo hi",\n    "a:one"');
    const d = computeCoordDelta({
      lines: ['package.json:"db:drift-check"'],
      tracked,
      readFile: (p: string) => (p === 'package.json' ? moved : null),
    });
    expect(d.drifted).toEqual([]);
  });

  it('still scores a positional pointer on the very same file by line blankness, unchanged', () => {
    const blankFirst = '{\n\n  "name": "x"\n}\n';
    const viaBlank = computeCoordDelta({
      lines: ['package.json:2'],
      tracked,
      readFile: () => blankFirst,
    });
    expect(viaBlank.drifted[0].why).toContain('package.json:2 is BLANK');
    const viaLive = computeCoordDelta({ lines: ['package.json:3'], tracked, readFile });
    expect(viaLive.drifted).toEqual([]);
  });

  it('drifts a keyed pointer aimed at a non-JSON file rather than skipping it', () => {
    const d = computeCoordDelta({ lines: ['lib/a.ts:"x"'], tracked, readFile });
    expect(d.drifted).toHaveLength(1);
    expect(d.drifted[0].why).toContain('not a .json file');
  });
});

describe('applyAllowlist and applyDriftAllowlist are form-sensitive', () => {
  const keyed = { cite: 'package.json:"db:drift-check"', regLine: 1, kind: 'key' };
  const entriesFor = (cite: string) => [{ cite, reason: 'test entry with a long enough reason' }];

  it('will not let a positional entry silence a keyed pointer', () => {
    expect(applyAllowlist([keyed], entriesFor('package.json:110')).fatal).toHaveLength(1);
    expect(applyDriftAllowlist([keyed], entriesFor('package.json:110')).fatal).toHaveLength(1);
    expect(applyAllowlist([keyed], entriesFor('package.json:110')).stale).toEqual(['package.json:110']);
  });

  it('does let the matching keyed entry suppress it', () => {
    expect(applyAllowlist([keyed], entriesFor('package.json:"db:drift-check"')).suppressed).toHaveLength(1);
    expect(applyDriftAllowlist([keyed], entriesFor('package.json:"db:drift-check"')).fatal).toHaveLength(0);
  });

  it('accepts an entry written as {path, key} and canonicalises it to the cite', () => {
    expect(canonicalCite({ path: 'package.json', key: 'db:drift-check' })).toBe('package.json:"db:drift-check"');
    expect(canonicalCite('ci.yml:81')).toBe('ci.yml:81');
    expect(canonicalCite({ reason: 'nothing addressable here' })).toBe(null);
    expect(applyAllowlist([keyed], [{ path: 'package.json', key: 'db:drift-check', reason: 'same pointer' }]).fatal)
      .toHaveLength(0);
  });
});

describe('computeDriftDelta — the value is the content', () => {
  const HEAD = 'a'.repeat(40);
  const OLD = 'b'.repeat(40);
  const rows = (text: string) => text.split('\n');

  const inject = (lines: string[], files: Record<string, Record<string, string>>) =>
    computeDriftDelta({
      lines,
      blame: new Map([[1, OLD]]),
      headSha: HEAD,
      trackedAt: () => ['package.json'],
      contentAt: (rev: string) => (files[rev] ? rows(files[rev]) : null),
    });

  it('calls a pointer whose key VALUE changed moved, printing both values', () => {
    const d = inject(['package.json:"db:drift-check"'], {
      [OLD]: KEYED_JSON,
      [HEAD]: KEYED_JSON.replace('npx tsx scripts/drift-check.ts', 'npx tsx scripts/drift-check.ts --yes'),
    });
    expect(d.moved).toHaveLength(1);
    expect(d.moved[0].cite).toBe('package.json:"db:drift-check"');
    expect(d.moved[0].then).toEqual(['npx tsx scripts/drift-check.ts']);
    expect(d.moved[0].now).toEqual(['npx tsx scripts/drift-check.ts --yes']);
    expect(d.moved[0].why).toContain('value is not what it was');
    expect(d.same).toBe(0);
  });

  it('counts an unrelated insertion above the key as SAME — the shift is invisible here', () => {
    const d = inject(['package.json:"db:drift-check"'], {
      [OLD]: KEYED_JSON,
      [HEAD]: KEYED_JSON.replace('"a:one"', '"zz:added": "echo hi",\n    "a:one"'),
    });
    expect(d.moved).toHaveLength(0);
    expect(d.same).toBe(1);
    expect(d.keyed).toBe(1);
  });

  it('scores a positional pointer over the same insertion as MOVED, which is the defect', () => {
    const d = inject(['package.json:5'], {
      [OLD]: KEYED_JSON,
      [HEAD]: KEYED_JSON.replace('"a:one"', '"zz:added": "echo hi",\n    "a:one"'),
    });
    expect(d.moved).toHaveLength(1);
    expect(d.moved[0].cite).toBe('package.json:5');
    expect(d.same).toBe(0);
  });

  it('fails a key that has been deleted from the current tree as drift, not as unverifiable', () => {
    const d = inject(['package.json:"db:drift-check"'], {
      [OLD]: KEYED_JSON,
      [HEAD]: '{"name": "nucrm-fixture", "scripts": {"a:one": "echo one"}}\n',
    });
    expect(d.moved).toHaveLength(1);
    expect(d.moved[0].why).toContain('not readable in the current tree');
    expect(d.unverifiable).toHaveLength(0);
  });

  it('reports unverifiable — never drift — when the key was not there in the authoring revision', () => {
    const d = inject(['package.json:"db:drift-check"'], {
      [OLD]: '{"name": "nucrm-fixture"}\n',
      [HEAD]: KEYED_JSON,
    });
    expect(d.unverifiable).toHaveLength(1);
    expect(d.unverifiable[0].why).toContain('held no readable value');
    expect(d.moved).toHaveLength(0);
  });

  it('separates an untracked path from a keyed pointer into a tracked one', () => {
    const d = computeDriftDelta({
      lines: ['next/dist/package.json:"x"'],
      blame: new Map([[1, OLD]]),
      headSha: HEAD,
      trackedAt: () => ['package.json'],
      contentAt: () => rows(KEYED_JSON),
    });
    expect(d.unresolved).toEqual(['next/dist/package.json:"x"']);
  });

  it('treats an ambiguous key as drift at HEAD and as unverifiable at the authoring revision', () => {
    const dup = '{"scripts": {"db:drift-check": "one"}, "other": {"db:drift-check": "two"}}\n';
    const now = inject(['package.json:"db:drift-check"'], { [OLD]: KEYED_JSON, [HEAD]: dup });
    expect(now.moved).toHaveLength(1);
    const then = inject(['package.json:"db:drift-check"'], { [OLD]: dup, [HEAD]: KEYED_JSON });
    expect(then.unverifiable).toHaveLength(1);
  });

  it('still flags a key citation authored by the measured revision as self-authored, not verified', () => {
    const d = computeDriftDelta({
      lines: ['package.json:"db:drift-check"'],
      blame: new Map([[1, HEAD]]),
      headSha: HEAD,
      trackedAt: () => ['package.json'],
      contentAt: () => rows(KEYED_JSON),
    });
    expect(d.same).toBe(1);
    expect(d.selfAuthored).toBe(1);
  });
});

describe('the two CLIs against a real repository', () => {
  it('guard:coords resolves the keyed pointer and the positional one together', () => {
    const repo = makeKeyedRepo(
      'coords-clean',
      'The alias reads `package.json:"db:drift-check"` and its neighbour `package.json:4`.\n',
    );
    const out = run(COORDS, ['--register', 'REG.md'], repo);
    expect(out.status).toBe(0);
    expect(out.out).toContain('2/2 citations resolve');
    expect(out.out).toContain('1 resolved by JSON key rather than line number');
  });

  it('guard:coords survives an unrelated script line inserted above the key — and breaks the positional neighbour', () => {
    const repo = makeKeyedRepo(
      'coords-shift',
      'The alias reads `package.json:"db:drift-check"` and its neighbour `package.json:4`.\n',
    );
    insertScriptLineAboveDriftCheck(repo);
    // Line 4 is now the inserted key line, still non-blank, so LIVENESS alone cannot see
    // that the pointer moved off the thing it meant. That is #2416's finding, reproduced.
    const out = run(COORDS, ['--register', 'REG.md'], repo);
    expect(out.status).toBe(0);
    expect(out.out).toContain('2/2 citations resolve');
  });

  it('guard:register-drift keeps the keyed pointer green while the positional one goes red', () => {
    const repo = makeKeyedRepo(
      'drift-shift',
      'The alias reads `package.json:"db:drift-check"` and its neighbour `package.json:4`.\n',
    );
    insertScriptLineAboveDriftCheck(repo);
    const out = run(DRIFT, ['--register', 'REG.md', '--allow', join(dir, 'no-allow-drift.json')], repo);
    expect(out.status).toBe(1);
    expect(out.out).toContain('2 citation instances');
    expect(out.out).toContain('(1 of them read by JSON key, not line number)');
    expect(out.out).toContain('1 moved');
    expect(out.out).toContain('reg:1  package.json:4');
    expect(out.out).not.toContain('reg:1  package.json:"db:drift-check"');
  });

  it('guard:register-drift fails when the KEY itself is renamed, which is the loud outcome', () => {
    const repo = makeKeyedRepo('drift-rename', 'The alias reads `package.json:"db:drift-check"`.\n');
    writeFileSync(join(repo, 'package.json'), KEYED_JSON.replace('db:drift-check', 'db:drift-check-v2'));
    git(repo, [...GIT_AUTHOR, 'add', '-A']);
    git(repo, [...GIT_AUTHOR, 'commit', '-q', '-m', 'rename the script key']);
    const drift = run(DRIFT, ['--register', 'REG.md', '--allow', join(dir, 'no-allow-rename.json')], repo);
    expect(drift.status).toBe(1);
    expect(drift.out).toContain('reg:1  package.json:"db:drift-check"');
    expect(drift.out).toContain('the key is not readable in the current tree');
    const coords = run(COORDS, ['--register', 'REG.md'], repo);
    expect(coords.status).toBe(1);
    expect(coords.out).toContain('has no "db:drift-check" key');
  });

  it('writes a keyed citation in an HTML comment the same way it writes a positional one', () => {
    const repo = makeKeyedRepo('coords-comment', '<!-- keyed pointer note: package.json:"db:drift-check" -->\n');
    const out = run(COORDS, ['--register', 'REG.md'], repo);
    expect(out.status).toBe(1);
    expect(out.out).toContain('comment guard failed');
    expect(out.out).toContain('1 minted inside a comment');
    expect(extractCommentCitations(readFileSync(join(repo, 'REG.md'), 'utf8').split('\n')).map((c: { cite: string }) => c.cite)).toEqual([
      'package.json:"db:drift-check"',
    ]);
  });

  it('regenerates a coords allowlist entry under the keyed cite when the key is missing', () => {
    const repo = makeKeyedRepo('coords-regen', 'The alias reads `package.json:"db:drift-check"`, not `package.json:"db:nope"`.\n');
    const allow = join(dir, 'allow-regen-keyed.json');
    writeFileSync(allow, JSON.stringify({ entries: [] }, null, 2));
    const out = run(COORDS, ['--register', 'REG.md', '--allow', allow, '--update'], repo);
    expect(out.status).toBe(0);
    expect(out.out).toContain('allowlist regenerated: 1 entries');
    const written = JSON.parse(readFileSync(allow, 'utf8'));
    expect(written.entries[0].cite).toBe('package.json:"db:nope"');
  });
});

describe('the real register, keyed where a key exists', () => {
  const lines = readFileSync(REGISTER, 'utf8').split('\n');
  const all = extractCitations(lines);
  const keyed = all.filter((c: { kind: string }) => c.kind === 'key');

  it('carries exactly the six pointers #3198 re-pinned by hand, all of them keyed now', () => {
    expect(keyed.map((c: { cite: string }) => c.cite).sort()).toEqual([
      'package.json:"db:deploy-migrate"',
      'package.json:"db:drift-check"',
      'package.json:"guard:catch-empty"',
      'package.json:"guard:cron-lock"',
      'package.json:"guard:panel-error-state"',
      'package.json:"guard:panel-error-state"',
    ]);
    // None of the six may still be written positionally: the pilot converts the pointer, it
    // does not add a second one beside it.
    expect(
      all.filter((c: { kind: string; cite: string }) => c.kind === 'line' && /^package\.json:(70|90|110|158|159)$/.test(c.cite)),
    ).toEqual([]);
  });

  it('names a key that actually exists, uniquely, in package.json', () => {
    const text = readFileSync(join(ROOT, 'package.json'), 'utf8');
    for (const c of keyed) {
      expect(resolveJsonKey(text, 'package.json', c.key).ok).toBe(true);
    }
  });

  it('mints no keyed pointer inside an HTML comment either', () => {
    expect(extractCommentCitations(lines)).toEqual([]);
  });

  it('leaves the guard totals exactly where they were before any pointer was keyed', () => {
    // Measured at c38b5deb: 468 instances, 463 resolvable, 5 unmatchable prose paths. Keying
    // a pointer must not remove it from the set that is checked — only change the question.
    const d = computeCoordDelta({
      lines,
      tracked: spawnSync('git', ['ls-files'], { encoding: 'utf8', cwd: ROOT }).stdout.split('\n').filter(Boolean),
      readFile: (p: string) => {
        try {
          return readFileSync(join(ROOT, p), 'utf8');
        } catch {
          return null;
        }
      },
    });
    expect(d.total).toBe(468);
    expect(d.checked).toBe(463);
    expect(d.keyed).toBe(6);
    expect(d.skipped.size).toBe(5);
    expect(d.drifted).toEqual([]);
  });
});
