/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3253 — a pm2 app that declares a log path without `merge_logs` writes an
 * id-suffixed file, so the path the config names never exists and whatever
 * tails it ships nothing. `cron` was that app; the screen exists so the next
 * one cannot be silent, and so a scraper cannot name a file no app declares
 * (the #2602 failure: a job tailing `/var/log/app`, zero targets, a pipeline
 * reporting itself configured).
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MIN_APPS,
  MIN_DECLARED_LOG_NAMES,
  analyze,
  loadEcosystem,
  run,
  scrapedLogPaths,
} from '../../scripts/check-pm2-log-paths.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-pm2-log-paths.mjs');
const ECO = readFileSync(join(ROOT, 'ecosystem.config.cjs'), 'utf8');
const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

const app = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  out_file: `/logs/${name}-out.log`,
  error_file: `/logs/${name}-error.log`,
  merge_logs: true,
  ...extra,
});

/** A temp repository root: `ecosystem.config.cjs` plus optional scrape configs. */
function plant(ecoSrc: string, configs: Record<string, string> = {}): string {
  const dir = mkdtempSync('/tmp/pm2-log-paths-');
  writeFileSync(join(dir, 'ecosystem.config.cjs'), ecoSrc);
  for (const [name, src] of Object.entries(configs)) {
    mkdirSync(join(dir, 'deploy', 'monitoring', 'promtail'), { recursive: true });
    writeFileSync(join(dir, 'deploy', 'monitoring', 'promtail', name), src);
  }
  return dir;
}

const THREE_APPS = `module.exports = { apps: [
  { name: 'web', out_file: '/logs/web-out.log', error_file: '/logs/web-error.log', merge_logs: true },
  { name: 'worker', out_file: '/logs/worker-out.log', error_file: '/logs/worker-error.log', merge_logs: true },
  { name: 'cron', out_file: '/logs/cron-out.log', error_file: '/logs/cron-error.log', merge_logs: true },
]};`;

describe('the tree this branch ships', () => {
  it('is green, and green means the three apps and their six paths', () => {
    const r = run(ROOT);
    expect(r.findings).toEqual([]);
    expect(r.apps).toEqual(['web', 'worker', 'cron']);
    expect(r.declared.sort()).toEqual([
      'cron-error.log',
      'cron-out.log',
      'web-error.log',
      'web-out.log',
      'worker-error.log',
      'worker-out.log',
    ]);
  });

  it('declares merge_logs inside the cron app, the app #3253 found missing', () => {
    const block = ECO.slice(ECO.indexOf("name: 'cron'"));
    expect(block.slice(0, block.indexOf('watch: false'))).toMatch(/merge_logs:\s*true/);
  });

  it('exits 0 from the command line', () => {
    const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('[check-pm2-log-paths] OK');
  });

  it('is wired into ci.yml by alias name, below every cited coordinate', () => {
    expect(CI).toContain('npm run guard:pm-log-paths');
    const lines = CI.split('\n');
    const jobLine = lines.findIndex((l) => l.includes('npm run guard:pm-log-paths')) + 1;
    // :221, :254, :401 and :447 are the coordinates the register cites; the job
    // is appended, so none of them moved.
    expect(jobLine).toBeGreaterThan(447);
    for (const n of [221, 254, 401, 447]) {
      expect(lines[n - 1]).toMatch(/check-audit-baseline|check-semgrep-baseline|Schema drift|check-env-coverage/);
    }
    expect(CI).toMatch(/constraint-vocab:/);
    const jobs = [...CI.matchAll(/^  ([\w-]+):$/gm)].map((m) => m[1]);
    expect(jobs[jobs.length - 1]).toBe('constraint-vocab');
  });

  it('is counted by the docs census, whose alias regex has no digit class', () => {
    const readme = readFileSync(join(ROOT, 'docs/README.md'), 'utf8');
    const para = /enforces \*\*(\d+)\*\*[^—]*—([\s\S]*?)—\s*plus/.exec(readme);
    expect(para).not.toBeNull();
    const named = [...para![2].matchAll(/`(guard:[a-z-]+)`/g)].map((m) => m[1]);
    expect(named).toContain('guard:pm-log-paths');
    expect(Number(para![1])).toBe(named.length);
    // The alias name itself is the constraint: `[a-z-]+` reads `guard:pm2-…` as
    // `guard:pm`, so a digit in the name makes the census disagree with the tree.
    expect('guard:pm-log-paths').toMatch(/^guard:[a-z-]+$/);
  });
});

describe('rule 1 — a declared log path must be the path pm2 writes', () => {
  it('fires on the #3253 shape: cron declaring both files with no merge_logs', () => {
    const f = analyze([app('web'), app('worker'), app('cron', { merge_logs: undefined })], []);
    expect(f.findings).toHaveLength(1);
    expect(f.findings[0].app).toBe('cron');
    expect(f.findings[0].problem).toMatch(/without merge_logs: true/);
  });

  it('fires on merge_logs explicitly false, which is the same lie', () => {
    expect(analyze([app('web'), app('worker'), app('cron', { merge_logs: false })], []).findings).toHaveLength(1);
  });

  it('reports one finding per app, naming the paths that will not exist', () => {
    const f = analyze([app('web', { merge_logs: false }), app('cron', { merge_logs: false })], []);
    expect(f.findings.map((x: { app: string }) => x.app)).toEqual(['web', 'cron']);
    expect(f.findings[0].problem).toContain('web-out.log');
  });

  it('says nothing about an app that declares no log file at all', () => {
    expect(analyze([{ name: 'cron', script: 'x' }, app('web'), app('worker')], []).findings).toEqual([]);
  });
});

describe('rule 2 — a tailed log must be one pm2 writes', () => {
  it('catches a file job tailing a name no app declares, which is #2602', () => {
    const dir = plant(THREE_APPS, {
      'bad.yml':
        'scrape_configs:\n  - job_name: app\n    static_configs:\n      - targets: []\n        labels:\n          __path__: /var/log/app/app-out.log\n',
    });
    const r = run(dir);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].file).toBe('deploy/monitoring/promtail/bad.yml');
    expect(r.findings[0].problem).toMatch(/app-out\.log, which no pm2 app declares/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a scraper tailing a declared name under a different mount prefix', () => {
    const dir = plant(THREE_APPS, {
      'ok.yml':
        'scrape_configs:\n  - job_name: cron\n    static_configs:\n      - targets: []\n        labels:\n          __path__: /home/nucrm/logs/cron-error.log\n',
    });
    expect(run(dir).findings).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves a non-pm2 log alone — a postgres glob is not a pm2 filename', () => {
    const dir = plant(THREE_APPS, {
      'pg.yml':
        'scrape_configs:\n  - job_name: pg\n    static_configs:\n      - targets: []\n        labels:\n          __path__: /var/log/postgresql/*.log\n',
    });
    expect(scrapedLogPaths([{ file: 'pg.yml', src: readFileSync(join(dir, 'deploy/monitoring/promtail/pg.yml'), 'utf8') }])).toEqual([]);
    expect(run(dir).findings).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a tailed path once per config, not once per mention', () => {
    const src =
      'scrape_configs:\n  - job_name: app\n    static_configs:\n      - targets: []\n        labels:\n          __path__: /var/log/app/app-out.log\n      - targets: []\n        labels:\n          __path__: /var/log/app/app-out.log\n';
    expect(
      analyze([app('web'), app('worker'), app('cron')], [
        { file: 'deploy/monitoring/promtail/x.yml', src },
      ]).findings,
    ).toHaveLength(1);
  });
});

describe('the screen fails closed rather than reporting a clean tree it never read', () => {
  it('throws when the ecosystem file is missing', () => {
    expect(() => loadEcosystem('/tmp/definitely-not-a-repo-root')).toThrow(/is missing/);
  });

  it('throws when fewer apps parse than the file is known to carry', () => {
    const dir = plant(`module.exports = { apps: [ ${JSON.stringify(app('web'))} ] };`);
    expect(() => loadEcosystem(dir)).toThrow(new RegExp(`floor ${MIN_APPS}`));
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when an app loses its log declarations out from under the screen', () => {
    const f = () =>
      analyze(
        [
          { name: 'web', out_file: '/logs/web-out.log', merge_logs: true },
          { name: 'worker', error_file: '/logs/worker-error.log', merge_logs: true },
          { name: 'cron', out_file: '/logs/cron-out.log', merge_logs: true },
        ],
        [],
      );
    expect(f).toThrow(new RegExp(`floor ${MIN_DECLARED_LOG_NAMES}`));
  });

  it('exits 1 from the command line when an app drops merge_logs', () => {
    const dir = plant(
      THREE_APPS.replace("name: 'cron', out_file: '/logs/cron-out.log', error_file: '/logs/cron-error.log', merge_logs: true", "name: 'cron', out_file: '/logs/cron-out.log', error_file: '/logs/cron-error.log'"),
    );
    // The CLI reads its root from the process cwd, so the fixture IS the tree.
    const r = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL — 1 log-path defect/);
    rmSync(dir, { recursive: true, force: true });
  });
});
