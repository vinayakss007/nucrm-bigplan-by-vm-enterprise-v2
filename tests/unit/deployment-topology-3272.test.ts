/**
 * #3272 — the repo documents two deployment models, and the host has to say
 * which one it is actually running.
 *
 * `deploy/DEPLOYMENT_PATHS.md` names Path A (production: pm2 on the VM, Docker
 * only for the data/monitoring tier) and Path B (development: the root Compose
 * stack). A checked-out tree contains both configs, so the old docs could be
 * read either way and a preflight could grade the wrong environment with a
 * straight face. This file pins three things:
 *
 *   - detection is about processes (`pm2 jlist`, the Compose service label),
 *     not files on disk;
 *   - `--auto-source` reads the pm2 env on Path A, refuses a Compose host
 *     instead of grading the host's env, and stops when both paths run;
 *   - the canonical decision stays at `DEPLOYMENT_PATHS.md:5-13`, because the
 *     issue register cites that exact range.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectHostTopology,
  detectTopology,
  formatTopology,
  parseDockerComposePs,
  parsePm2Jlist,
} from '../../scripts/lib/deployment-topology.mjs';
import { resolveEffectiveEnv } from '../../scripts/assert-runtime-env.mjs';

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const pm2Json = (names: string[], status = 'online') =>
  JSON.stringify(names.map((name) => ({ name, pm2_env: { status } })));

const dockerPs = (rows: [name: string, service: string][]) =>
  rows.map(([name, service]) => `${name}|${service}`).join('\n');

const noFiles = () => null;
const noEcosystem = () => ({});

describe('#3272 the host says which deployment path it runs', () => {
  it('reads only online pm2 apps, and treats a broken answer as no evidence', () => {
    expect(parsePm2Jlist(pm2Json(['web', 'worker']))).toEqual([
      { name: 'web', status: 'online' },
      { name: 'worker', status: 'online' },
    ]);
    expect(parsePm2Jlist(pm2Json(['web'], 'stopped'))).toEqual([]);
    expect(parsePm2Jlist('not json')).toEqual([]);
    expect(parsePm2Jlist(null)).toEqual([]);
  });

  it('reads the Compose service label, not the container name', () => {
    expect(parseDockerComposePs(dockerPs([['nucrm-app', 'web'], ['nucrm-postgres', 'postgres']]))).toEqual([
      { name: 'nucrm-app', service: 'web' },
      { name: 'nucrm-postgres', service: 'postgres' },
    ]);
    expect(parseDockerComposePs('nucrm-app|')).toEqual([{ name: 'nucrm-app', service: '' }]);
  });

  it('classifies pm2, Compose, both, and neither', () => {
    const pm2Only = detectTopology({ pm2Json: pm2Json(['web', 'worker']) });
    expect(pm2Only.kind).toBe('pm2');
    expect(pm2Only.pm2App).toBe('web');

    const composeOnly = detectTopology({
      dockerPs: dockerPs([['nucrm-app', 'web'], ['nucrm-worker', 'worker']]),
    });
    expect(composeOnly.kind).toBe('compose');
    expect(composeOnly.compose.map((c) => c.service)).toEqual(['web']);

    const both = detectTopology({
      pm2Json: pm2Json(['web']),
      dockerPs: dockerPs([['nucrm-app', 'web']]),
    });
    expect(both.kind).toBe('both');

    expect(detectTopology({}).kind).toBe('unknown');
  });

  it('does not call a worker-only pm2 host a readable app', () => {
    const report = detectTopology({ pm2Json: pm2Json(['worker']) });
    expect(report.kind).toBe('pm2');
    expect(report.pm2App).toBeNull();
    expect(report.detail).toContain('no Next app');
  });

  it('asks the two commands and survives either one being absent', () => {
    const seen: string[] = [];
    const report = detectHostTopology((cmd: string) => {
      seen.push(cmd);
      if (cmd === 'pm2') return pm2Json(['nucrm-prod']);
      throw new Error('docker is not installed');
    });
    expect(seen).toEqual(['pm2', 'docker']);
    expect(report.kind).toBe('pm2');
    expect(report.pm2App).toBe('nucrm-prod');

    expect(detectHostTopology(() => null).kind).toBe('unknown');
  });

  it('prints the path and the env source it will read', () => {
    expect(formatTopology(detectTopology({ pm2Json: pm2Json(['web']) }))).toContain(
      'Path A — production',
    );
    expect(
      formatTopology(detectTopology({ dockerPs: dockerPs([['nucrm-app', 'web']]) })),
    ).toContain('Path B — Docker Compose');
    expect(
      formatTopology(
        detectTopology({ pm2Json: pm2Json(['web']), dockerPs: dockerPs([['nucrm-app', 'web']]) }),
      ),
    ).toContain('BOTH');
    expect(formatTopology(detectTopology({}))).toContain('unknown');
  });
});

describe('#3272 --auto-source reads the running path, and refuses the wrong one', () => {
  it('reads the live pm2 app env on Path A', () => {
    const json = JSON.stringify([
      { name: 'web', pm2_env: { status: 'online', NODE_ENV: 'production', TRUST_PROXY: 'true' } },
    ]);
    const result = resolveEffectiveEnv({
      argv: ['--auto-source'],
      shellEnv: {},
      readFile: noFiles,
      loadEcosystem: noEcosystem,
      runCommand: (cmd: string) => (cmd === 'pm2' ? json : null),
    });
    expect(result.source).toContain('pm2 jlist -> "web"');
    expect(result.env.NODE_ENV).toBe('production');
    expect(result.env.TRUST_PROXY).toBe('true');
  });

  it('refuses to grade a Compose host and names the in-container command', () => {
    expect(() =>
      resolveEffectiveEnv({
        argv: ['--auto-source'],
        shellEnv: {},
        readFile: noFiles,
        loadEcosystem: noEcosystem,
        runCommand: (cmd: string) =>
          cmd === 'docker' ? dockerPs([['nucrm-app', 'web']]) : null,
      }),
    ).toThrow(/exec app node scripts\/assert-runtime-env\.mjs --expect-production --process-only/);
  });

  it('stops when both paths are running on one host', () => {
    expect(() =>
      resolveEffectiveEnv({
        argv: ['--auto-source'],
        shellEnv: {},
        readFile: noFiles,
        loadEcosystem: noEcosystem,
        runCommand: (cmd: string) =>
          cmd === 'pm2' ? pm2Json(['web']) : dockerPs([['nucrm-app', 'web']]),
      }),
    ).toThrow(/Both deployment paths are running/);
  });

  it('refuses pm2 with no Next app instead of reading a worker env', () => {
    expect(() =>
      resolveEffectiveEnv({
        argv: ['--auto-source'],
        shellEnv: {},
        readFile: noFiles,
        loadEcosystem: noEcosystem,
        runCommand: (cmd: string) => (cmd === 'pm2' ? pm2Json(['worker']) : null),
      }),
    ).toThrow(/no Next app/);
  });

  it('falls back to the repository env files when nothing is running', () => {
    const result = resolveEffectiveEnv({
      argv: ['--auto-source'],
      shellEnv: {},
      readFile: (candidate: string) =>
        candidate === '.env.local' ? 'NODE_ENV=production\n' : null,
      loadEcosystem: noEcosystem,
      runCommand: () => null,
    });
    expect(result.source).toContain('.env.local');
    expect(result.env.NODE_ENV).toBe('production');
  });

  it('keeps an explicit --pm2 reading ahead of auto-detection', () => {
    const json = pm2Json(['web']);
    const result = resolveEffectiveEnv({
      argv: ['--auto-source', '--pm2', 'web'],
      shellEnv: {},
      readFile: noFiles,
      loadEcosystem: noEcosystem,
      runCommand: (cmd: string) => (cmd === 'pm2' ? json : null),
    });
    expect(result.source).toContain('pm2 jlist -> "web"');
  });
});

describe('#3272 the decision is written where the operator looks', () => {
  it('wires --auto-source into prod:preflight without dropping the env assert', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['prod:preflight']).toContain('scripts/assert-runtime-env.mjs');
    expect(scripts['prod:preflight']).toContain('--expect-production');
    expect(scripts['prod:preflight']).toContain('--auto-source');
  });

  it('makes the runbook state Path A and link to the canonical decision', () => {
    const runbook = read('deploy/LAUNCH_RUNBOOK.md');
    expect(runbook).toContain('deploy/DEPLOYMENT_PATHS.md');
    expect(runbook).toContain('Path A — PM2 on the VM');
    expect(runbook).toContain('--auto-source');
    expect(runbook).not.toContain('single VM running the Docker Compose stack');
  });

  it('marks the Compose guide as the data tier / development path', () => {
    const guide = read('deploy/DEPLOYMENT_INTERNAL.md');
    expect(guide).toContain('Topology (#3272)');
    expect(guide).toContain('deploy/DEPLOYMENT_PATHS.md');
    expect(guide).toContain('Path B rows');
  });

  it('gives both paths a per-file table', () => {
    const paths = read('deploy/DEPLOYMENT_PATHS.md');
    expect(paths).toContain('Which file belongs to which path (#3272)');
    for (const row of [
      'ecosystem.config.cjs',
      'docker-compose.yml',
      'deploy/cron/crontab',
      '3099',
      'Path A is canonical',
    ]) {
      expect(paths, row).toContain(row);
    }
  });

  it('keeps the canonical decision at the range the register cites', () => {
    // docs/infra/PREPROD-ISSUE-REGISTER.md cites `deploy/DEPLOYMENT_PATHS.md:5-13`.
    // Inserting the per-file table above line 5 would silently invalidate it.
    const lines = read('deploy/DEPLOYMENT_PATHS.md').split('\n');
    expect(lines[4]).toContain('Production → PM2 on the VM');
    expect(lines[9]).toContain('Development → Docker');
    expect(lines[12]).toBe('');
  });
});
