/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * PM2 log-path identity guard (#3253).
 *
 * pm2 names a log file two ways. With `merge_logs` set it writes exactly the
 * path the ecosystem file declares; without it, in fork mode, it writes
 * `<name>-out-<id>.log` — the process id is IN the filename — and the declared
 * path never appears on disk. `web` and `worker` set `merge_logs`; `cron` did
 * not, so `logs/cron-out.log` and `logs/cron-error.log` were fiction while
 * `logs/cron-out-0.log` held the only record of every scheduled run. Cron
 * errors are precisely what an operator wants readable, and the failure is
 * silent: nothing errors, the file the runbook names is simply absent.
 *
 * The generalisation the issue asks for is an ASSERTION, because the config
 * file and the thing that reads it are edited by different people:
 *
 *   1. every app that declares a log path also pins `merge_logs: true`, so the
 *      declared path is the path pm2 writes;
 *   2. every `-out.log` / `-error.log` path a scraper in this repo tails names a
 *      file some pm2 app declares.
 *
 * Rule 2 compares BASENAMES, not full paths: the same log is reached as
 * `/home/nucrm/logs/cron-error.log` on the host and through a bind mount inside
 * a container, and #3253 is a filename defect, not a directory defect. Matching
 * on the basename is also what makes the rule able to fire: a job re-added like
 * the deleted `/var/log/app` one (#2602 — it tailed paths that existed nowhere
 * and Loki held no application logs while the pipeline reported "configured")
 * names `app-out.log`, nothing declares that, and the screen goes red.
 *
 * The ecosystem file is `require`d, not regexed: pm2 reads it the same way, so
 * the answer is what pm2 would actually do with `${LOG_DIR}` and the
 * `.env.local`/`process.env` precedence resolved, rather than a pattern that
 * breaks the day someone reformats the literal.
 *
 * Usage: npm run guard:pm-log-paths [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative } from 'node:path';

export const ROOT = process.cwd();
/** Fewer apps than this means the file stopped loading, not that the repo shrank. */
export const MIN_APPS = 3;
/** web/worker/cron each declare out+error: a set this small lost an app or a field. */
export const MIN_DECLARED_LOG_NAMES = 4;

const require = createRequire(join(ROOT, 'noop.cjs'));

/** The config exactly as pm2 evaluates it — same file, same precedence. */
export function loadEcosystem(root = ROOT) {
  const path = join(root, 'ecosystem.config.cjs');
  if (!existsSync(path)) throw new Error(`${path} is missing — nothing can assert pm2's log paths`);
  const mod = require(path);
  const apps = mod?.apps;
  if (!Array.isArray(apps)) throw new Error('ecosystem.config.cjs exported no `apps` array');
  if (apps.length < MIN_APPS) {
    throw new Error(
      `only ${apps.length} app(s) parsed; the walk stopped reading the file it guards (floor ${MIN_APPS})`,
    );
  }
  return apps;
}

/** The log paths an app declares, and the flag that makes those paths real. */
export function appLogDecls(apps) {
  return apps
    .map((app) => ({
      name: app?.name ?? '?',
      paths: [app?.out_file, app?.error_file].filter((p) => typeof p === 'string' && p.length > 0),
      mergeLogs: app?.merge_logs,
    }))
    .filter((a) => a.paths.length > 0);
}

/**
 * Every YAML under `deploy/monitoring/` that could tail a log file. Walked
 * rather than hand-listed: the next scraper config is written into a new file,
 * and a guard that only knows yesterday's filenames is the guard #2602 needed.
 */
export function scrapeConfigs(root = ROOT, dir = join(root, 'deploy', 'monitoring')) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ya?ml)$/.test(entry)) out.push({ file: relative(root, p), src: readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

const PM2_LOG_NAME = /[\w.-]+-(?:out|error)\.log/g;

/**
 * `__path__:` globs and `targets:` entries, the two ways promtail names a file.
 * A wildcard glob (`/var/log/postgresql/*.log`) is kept as its directory part —
 * rule 2 only fires on names shaped like pm2 logs, and `*.log` is not one.
 */
export function scrapedLogPaths(configs) {
  const found = [];
  for (const { file, src } of configs) {
    for (const line of src.split('\n')) {
      if (!/__path__\s*:|targets?\s*:/.test(line)) continue;
      for (const m of line.matchAll(PM2_LOG_NAME)) found.push({ file, path: m[0] });
    }
  }
  return found;
}

export function analyze(apps, configs) {
  const findings = [];
  const decls = appLogDecls(apps);
  const declared = new Set();
  for (const d of decls) for (const p of d.paths) declared.add(basename(p));
  if (declared.size < MIN_DECLARED_LOG_NAMES) {
    throw new Error(
      `only ${declared.size} declared log name(s); an app lost its out_file/error_file (floor ${MIN_DECLARED_LOG_NAMES})`,
    );
  }

  // Rule 1 — one finding per app: the defect is the missing flag, and naming the
  // app is enough to fix it.
  for (const d of decls) {
    if (d.mergeLogs === true) continue;
    findings.push({
      file: 'ecosystem.config.cjs',
      app: d.name,
      problem: `declares ${d.paths.map((p) => basename(p)).join(' and ')} without merge_logs: true — fork mode writes the id-suffixed name and these paths never exist`,
    });
  }

  // Rule 2 — one finding per (config file, scraped name).
  const seen = new Set();
  for (const s of scrapedLogPaths(configs)) {
    if (declared.has(basename(s.path))) continue;
    const key = `${s.file}\u0000${s.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      file: s.file,
      app: null,
      problem: `tails ${s.path}, which no pm2 app declares — the pipeline will report configured and ship nothing`,
    });
  }
  return { findings, declared: [...declared].sort(), apps: decls.map((d) => d.name) };
}

export function run(root = ROOT) {
  return { ...analyze(loadEcosystem(root), scrapeConfigs(root)), root };
}

function main() {
  const asJson = process.argv.includes('--json');
  const { findings, declared, apps } = run();
  if (asJson) {
    console.log(JSON.stringify({ findings, declared, apps }, null, 2));
  } else {
    for (const f of findings) console.log(`  ✖ ${f.file}${f.app ? ` (${f.app})` : ''}: ${f.problem}`);
  }
  if (findings.length > 0) {
    console.error(
      `[check-pm2-log-paths] FAIL — ${findings.length} log-path defect(s) above; a pm2 path must be the path pm2 writes, and a scraped path must be one pm2 writes.`,
    );
    process.exit(1);
  }
  console.log(
    `[check-pm2-log-paths] OK — ${apps.join(', ')} all pin merge_logs; every declared name (${declared.join(', ')}) is the name pm2 writes, and nothing in deploy/ tails a log no app declares.`,
  );
}

if (process.argv[1] && process.argv[1].includes('check-pm2-log-paths')) main();
