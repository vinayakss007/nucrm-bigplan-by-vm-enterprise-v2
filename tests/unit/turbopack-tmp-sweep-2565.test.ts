/**
 * #2565 — /tmp is a 3.9 GB tmpfs on the host. Turbopack leaves one 21-character
 * cache directory behind per killed build; 661 of them held 3.6 GB and made
 * `npx vitest run` exit 1 with no summary. The sweep must delete only dead
 * caches, and the build wrapper must stop new ones landing on the tmpfs.
 *
 * Every "kept" case below is as important as the "removed" one: a sweep that
 * deletes a live build's cache or an unrelated directory is worse than the
 * leak it fixes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  findCandidates,
  hasOpenHandle,
  isTurbopackCacheDir,
  sweep,
} from '../../scripts/sweep-turbopack-tmp.mjs';
import { buildTmpDir } from '../../scripts/build.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts/sweep-turbopack-tmp.mjs');
const OLD = Date.now() - 48 * 60 * 60 * 1000;
const FRESH = Date.now();

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'turbopack-sweep-')));
  created.push(dir);
  return dir;
}

function cacheDir(root: string, name: string, opts: { old?: boolean; extra?: string[] } = {}): string {
  const dir = join(root, name);
  mkdirSync(join(dir, 'client'), { recursive: true });
  mkdirSync(join(dir, 'ssr'), { recursive: true });
  writeFileSync(join(dir, 'client', 'chunk'), 'x');
  for (const extra of opts.extra ?? []) writeFileSync(join(dir, extra), 'x');
  const when = opts.old === false ? new Date(FRESH) : new Date(OLD);
  utimesSync(dir, when, when);
  return dir;
}

const name = (char: string) => char.repeat(21);

describe('the Turbopack cache signature (#2565)', () => {
  it('accepts only a 21-character name holding exactly client/ and ssr/', () => {
    const root = tempRoot();
    expect(isTurbopackCacheDir(cacheDir(root, name('a')))).toBe(true);

    expect(isTurbopackCacheDir(cacheDir(root, name('b'), { extra: ['lock'] }))).toBe(false);
    expect(isTurbopackCacheDir(join(root, name('c')))).toBe(false); // does not exist
  });

  it('does not treat a plain file with the same name as a cache dir', () => {
    const root = tempRoot();
    writeFileSync(join(root, name('d')), 'not a dir');
    expect(findCandidates(root, { now: Date.now(), procRoot: join(root, 'proc') }).candidates).toEqual([]);
  });
});

describe('candidate selection (#2565)', () => {
  it('selects only old, complete, unheld caches', () => {
    const root = tempRoot();
    const old = cacheDir(root, name('a'));
    cacheDir(root, name('b'), { old: false }); // fresh: possibly a live build
    cacheDir(root, 'short'); // wrong name length
    cacheDir(root, name('c'), { extra: ['lock'] }); // not the cache layout
    mkdirSync(join(root, 'proc')); // exists but holds no fds

    const { candidates, skipped } = findCandidates(root, {
      now: Date.now(),
      maxAgeHours: 24,
      procRoot: join(root, 'proc'),
    });
    expect(candidates).toEqual([old]);
    expect(skipped).toEqual([]);
  });

  it('keeps a cache that a process still holds open', () => {
    const root = tempRoot();
    const held = cacheDir(root, name('a'));
    const fdDir = join(root, 'proc', '123', 'fd');
    mkdirSync(fdDir, { recursive: true });
    symlinkSync(join(held, 'client', 'chunk'), join(fdDir, '4'));

    const { candidates, skipped } = findCandidates(root, {
      now: Date.now(),
      maxAgeHours: 24,
      procRoot: join(root, 'proc'),
    });
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([{ path: held, reason: 'open file handle' }]);
  });

  it('treats a missing /proc as "cannot prove it is safe" and deletes nothing', () => {
    const root = tempRoot();
    cacheDir(root, name('a'));
    const { candidates, skipped } = findCandidates(root, {
      now: Date.now(),
      procRoot: join(root, 'no-such-proc'),
    });
    expect(candidates).toEqual([]);
    expect(skipped[0]?.reason).toMatch(/no \/proc/);
  });

  it('matches the directory itself, not a sibling with the same prefix', () => {
    const targets = ['/tmp/abc/client/chunk', '/tmp/abcd/client/chunk'];
    expect(hasOpenHandle('/tmp/abc', targets)).toBe(true);
    expect(hasOpenHandle('/tmp/ab', targets)).toBe(false);
  });
});

describe('the sweep applies the plan only with --yes (#2565)', () => {
  it('plans without deleting, then deletes exactly the candidates', () => {
    const root = tempRoot();
    const dead = cacheDir(root, name('a'));
    const live = cacheDir(root, name('b'), { old: false });
    mkdirSync(join(root, 'proc'));

    const planned = sweep({ root, procRoot: join(root, 'proc'), apply: false });
    expect(planned.candidates).toEqual([dead]);
    expect(existsSync(dead)).toBe(true);

    const applied = sweep({ root, procRoot: join(root, 'proc'), apply: true });
    expect(applied.candidates).toEqual([dead]);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it('is a dry run by default and requires --yes on the command line', () => {
    const root = tempRoot();
    const dead = cacheDir(root, name('a'));
    mkdirSync(join(root, 'proc'));

    const dry = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/pass --yes/);
    expect(existsSync(dead)).toBe(true);

    const json = spawnSync(process.execPath, [SCRIPT, '--root', root, '--yes', '--json'], {
      encoding: 'utf8',
    });
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout).candidates).toEqual([dead]);
    expect(existsSync(dead)).toBe(false);
  });

  it('refuses to sweep the filesystem root', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '--root', '/', '--yes'], { encoding: 'utf8' });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/refusing/);
  });
});

describe('the build wrapper keeps Turbopack off the tmpfs (#2565)', () => {
  it('defaults to the root filesystem and honours an override', () => {
    expect(buildTmpDir({}, 'linux')).toBe('/var/tmp/nucrm-build');
    expect(buildTmpDir({ NUCRM_BUILD_TMPDIR: '/data/tmp' }, 'linux')).toBe('/data/tmp');
    expect(buildTmpDir({ TEMP: '/win/temp' }, 'win32')).toContain('nucrm-build');
  });

  it('runs `next build`, forwards arguments, and sets TMPDIR/TMP/TEMP', () => {
    const repo = tempRoot();
    const binDir = join(repo, 'node_modules', 'next', 'dist', 'bin');
    mkdirSync(binDir, { recursive: true });
    const out = join(repo, 'seen.json');
    writeFileSync(
      join(binDir, 'next'),
      "require('node:fs').writeFileSync(process.env.OUT, JSON.stringify({ tmp: process.env.TMPDIR, tmp2: process.env.TMP, tmp3: process.env.TEMP, args: process.argv.slice(2) })); process.exit(7);",
    );
    const buildTmp = join(repo, 'buildtmp');

    const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--debug'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, OUT: out, NUCRM_BUILD_TMPDIR: buildTmp },
    });
    expect(res.status, res.stderr).toBe(7);

    const seen = JSON.parse(readFileSync(out, 'utf8'));
    expect(seen.tmp).toBe(buildTmp);
    expect(seen.tmp2).toBe(buildTmp);
    expect(seen.tmp3).toBe(buildTmp);
    expect(seen.args).toEqual(['build', '--debug']);
    expect(statSync(buildTmp).isDirectory()).toBe(true);
  });

  it('is the command npm run build actually uses', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toBe('node scripts/build.mjs');
    expect(pkg.scripts['sweep:turbopack-tmp']).toBe('node scripts/sweep-turbopack-tmp.mjs');
  });
});

describe('the daily timer is documented and wired (#2565)', () => {
  const SERVICE = readFileSync(join(ROOT, 'deploy/systemd/nucrm-tmp-sweep.service'), 'utf8');
  const TIMER = readFileSync(join(ROOT, 'deploy/systemd/nucrm-tmp-sweep.timer'), 'utf8');
  const README = readFileSync(join(ROOT, 'deploy/systemd/README.md'), 'utf8');

  it('runs the sweep with --yes for /tmp and the build TMPDIR', () => {
    expect(SERVICE).toMatch(/sweep-turbopack-tmp\.mjs --root \/tmp --yes/);
    expect(SERVICE).toMatch(/sweep-turbopack-tmp\.mjs --root \/var\/tmp\/nucrm-build --yes/);
    expect(SERVICE).toMatch(/Type=oneshot/);
  });

  it('schedules daily and catches up after a reboot', () => {
    expect(TIMER).toMatch(/OnCalendar=/);
    expect(TIMER).toMatch(/Persistent=true/);
    expect(TIMER).toMatch(/Unit=nucrm-tmp-sweep\.service/);
  });

  it('documents the install and the two halves of the fix', () => {
    expect(README).toMatch(/systemctl enable --now nucrm-tmp-sweep\.timer/);
    expect(README).toMatch(/NUCRM_BUILD_TMPDIR/);
    expect(README).toMatch(/deletes nothing without `--yes`/);
  });
});
