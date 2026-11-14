#!/usr/bin/env node
/**
 * #2565 — sweep orphaned Turbopack cache directories out of /tmp.
 *
 * Turbopack creates one temp directory per `next build` / `next dev` run. A run
 * that is killed — a timeout, Ctrl-C, an OOM — never removes it. `/tmp` on the
 * host is a 3.9 GB tmpfs, and 661 of these held 3.6 GB of it; once it is full,
 * `npx vitest run` exits 1 with no `Test Files` / `Tests` summary, so a scratch
 * space outage looks exactly like a red suite.
 *
 * A directory is removed only when ALL of these hold:
 *
 *   1. its name is exactly 21 alphanumeric characters (Turbopack's tempdir name);
 *   2. it contains exactly `client/` and `ssr/`, both directories — the cache
 *      layout measured on the host;
 *   3. no process holds an open file under it (read through /proc);
 *   4. its mtime is older than `--max-age-hours` (default 24).
 *
 * Anything that fails a check is left alone. This is deliberately NOT a blanket
 * `rm -rf /tmp/*`, and it deletes nothing without `--yes`/`--confirm`.
 *
 * Usage:
 *   node scripts/sweep-turbopack-tmp.mjs                 # dry run, prints candidates
 *   node scripts/sweep-turbopack-tmp.mjs --json          # same, machine-readable
 *   node scripts/sweep-turbopack-tmp.mjs --yes           # delete
 *   node scripts/sweep-turbopack-tmp.mjs --root /tmp --max-age-hours 24 --yes
 *
 * The daily timer is `deploy/systemd/nucrm-tmp-sweep.timer`. Builds started
 * through `npm run build` already write to `/var/tmp/nucrm-build` (scripts/
 * build.mjs), so the timer sweeps that directory too.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Turbopack's tempdir name: 21 random alphanumeric characters, no prefix. */
export const TURBOPACK_TMP_NAME = /^[A-Za-z0-9]{21}$/;

/** True when `path` is a directory with exactly the two Turbopack cache children. */
export function isTurbopackCacheDir(path) {
  let names;
  try {
    names = readdirSync(path);
  } catch {
    return false;
  }
  if (names.length !== 2) return false;
  const set = new Set(names);
  if (!set.has('client') || !set.has('ssr')) return false;
  for (const name of ['client', 'ssr']) {
    try {
      if (!lstatSync(join(path, name)).isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Every path currently held open by a process, read once per sweep.
 * `null` means /proc is unavailable, so "no process holds it" cannot be proven
 * and the caller must not delete anything.
 */
export function collectOpenTargets(procRoot = '/proc') {
  if (!existsSync(procRoot)) return null;
  const targets = [];
  for (const pid of readdirSync(procRoot)) {
    if (!/^\d+$/.test(pid)) continue;
    const fdDir = join(procRoot, pid, 'fd');
    let fds;
    try {
      fds = readdirSync(fdDir);
    } catch {
      continue; // another user's process, or it exited between readdir and open
    }
    for (const fd of fds) {
      try {
        targets.push(readlinkSync(join(fdDir, fd)));
      } catch {
        // The fd was closed while we walked; not an error.
      }
    }
  }
  return targets;
}

/** True when any collected fd target is the directory or a file inside it. */
export function hasOpenHandle(path, openTargets) {
  const prefix = path.endsWith('/') ? path : `${path}/`;
  return openTargets.some((target) => target === path || target.startsWith(prefix));
}

/** Recursive byte count; used only for the report, never for the decision. */
export function dirSize(path) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(child);
    } else if (entry.isFile()) {
      try {
        total += statSync(child).size;
      } catch {
        // Raced with a build or another sweep; the directory-level check still holds.
      }
    }
  }
  return total;
}

/**
 * Directories eligible for deletion, plus the near-misses and why they were
 * kept. `now` is injectable so the age rule is testable without touching mtimes
 * of live data.
 */
export function findCandidates(
  root,
  { maxAgeHours = 24, now = Date.now(), procRoot = '/proc' } = {},
) {
  const cutoff = now - maxAgeHours * 60 * 60 * 1000;
  const openTargets = collectOpenTargets(procRoot);
  const candidates = [];
  const skipped = [];

  for (const name of readdirSync(root)) {
    const path = join(root, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue; // vanished between readdir and lstat
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    if (!TURBOPACK_TMP_NAME.test(name)) continue;
    if (stat.mtimeMs > cutoff) continue; // fresh enough to be a live build
    if (!isTurbopackCacheDir(path)) continue;
    if (openTargets === null) {
      skipped.push({ path, reason: 'no /proc: cannot prove no process holds it' });
      continue;
    }
    if (hasOpenHandle(path, openTargets)) {
      skipped.push({ path, reason: 'open file handle' });
      continue;
    }
    candidates.push(path);
  }

  return { candidates, skipped };
}

/** Plan, and optionally apply, one sweep. Returns the report the CLI prints. */
export function sweep({
  root = '/tmp',
  maxAgeHours = 24,
  now = Date.now(),
  procRoot = '/proc',
  apply = false,
} = {}) {
  const { candidates, skipped } = findCandidates(root, { maxAgeHours, now, procRoot });
  const bytes = candidates.reduce((sum, path) => sum + dirSize(path), 0);
  if (apply) {
    for (const path of candidates) rmSync(path, { recursive: true, force: true });
  }
  return { root, maxAgeHours, apply, candidates, skipped, bytes };
}

function humanBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes} B`;
}

function parseArgs(argv) {
  const opts = { root: '/tmp', maxAgeHours: 24, apply: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') opts.root = argv[++i];
    else if (arg === '--max-age-hours') opts.maxAgeHours = Number(argv[++i]);
    else if (arg === '--yes' || arg === '--confirm') opts.apply = true;
    else if (arg === '--dry-run') opts.apply = false;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(opts.maxAgeHours) || opts.maxAgeHours < 0) {
    throw new Error('--max-age-hours must be a non-negative number');
  }
  return opts;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`[sweep-turbopack-tmp] ${err.message}`);
    return 2;
  }
  if (opts.help) {
    console.log('Usage: node scripts/sweep-turbopack-tmp.mjs [--root DIR] [--max-age-hours N] [--yes] [--json]');
    return 0;
  }

  let root;
  try {
    root = realpathSync(resolve(opts.root));
  } catch {
    console.log(`[sweep-turbopack-tmp] root ${opts.root} does not exist; nothing to sweep`);
    return 0;
  }
  if (root === '/') {
    console.error('[sweep-turbopack-tmp] refusing to sweep the filesystem root');
    return 2;
  }

  const report = sweep({ ...opts, root });
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  const verb = opts.apply ? 'removed' : 'would remove';
  console.log(
    `[sweep-turbopack-tmp] root=${root} max-age=${opts.maxAgeHours}h ` +
      `candidates=${report.candidates.length} bytes=${humanBytes(report.bytes)}`,
  );
  for (const path of report.candidates) console.log(`  ${verb}: ${path}`);
  for (const { path, reason } of report.skipped) console.log(`  kept: ${path} (${reason})`);
  if (!opts.apply) {
    console.log('[sweep-turbopack-tmp] nothing deleted; pass --yes to remove the candidates');
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
