/**
 * #2332 — the running-config drift guard must be able to say "NOT APPLICABLE".
 *
 * Before the fix, `npm run guard:running-config` on a host without
 * compose-labelled containers printed `0 identical · 0 drifted · 0 unchecked`
 * and exited 0 — a green that inspected nothing. These tests spawn the real
 * script against a `docker` test double (tests/fixtures/fake-docker) and pin
 * the exit-code contract:
 *   0 — something was inspected and matches
 *   1 — drift / missing service / untagged release
 *   2 — NOT APPLICABLE: nothing (or only part) could be inspected
 * with `--allow-empty` / `RUNNING_CONFIG_ALLOW_EMPTY=1` the only way to turn 2
 * into a printed skip. Wiring (nightly schedule + artifact) is pinned at the end.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, 'scripts/check-running-config-drift.mjs');
const FAKE_BIN = resolve(ROOT, 'tests/fixtures/fake-docker');

function runGuard(state: unknown, opts: { args?: string[]; extraEnv?: Record<string, string>; barePath?: boolean } = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${FAKE_BIN}:${process.env['PATH'] ?? ''}`,
    FAKE_DOCKER_STATE: JSON.stringify(state),
    COMPOSE_PROJECT: 'deploy',
    ...(opts.extraEnv ?? {}),
  };
  if (opts.barePath) env.PATH = '/nonexistent-test-path';
  const res = spawnSync(process.execPath, [SCRIPT, ...(opts.args ?? [])], {
    cwd: ROOT,
    encoding: 'utf8',
    env: env as NodeJS.ProcessEnv,
  });
  return { code: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

// A one-container world with everything matching: mounts empty, stop_grace at
// the default on both sides, no BUILD_ID (so no release identity to report).
const CLEAN_APP = {
  all: ['deploy-app-1'],
  live: ['deploy-app-1'],
  created: ['deploy-app-1'],
  compose: { app: {} },
  containers: {
    'deploy-app-1': { service: 'app', configFiles: '/x/docker-compose.yml', mounts: [] },
  },
  exec: {},
};

describe('#2332 empty is not clean (exit 2)', () => {
  it('exits 2 with NOT APPLICABLE when no compose-labelled container exists', () => {
    const { code, out } = runGuard({ all: [], live: [], compose: { app: {} } });
    expect(code).toBe(2);
    expect(out).toContain("NOT APPLICABLE — no compose-labelled containers for project 'deploy' found (0 inspected)");
    // The whole point: the vacuous all-zeros bill of health is now impossible.
    expect(out).not.toContain('running-config drift: 0 identical');
  });

  it('names the services the repo compose files declare but nothing runs (AC: declare app, run nothing -> fail naming it)', () => {
    const { code, out } = runGuard({ all: [], live: [], compose: { app: {}, nginx: {} } });
    expect(code).toBe(2);
    expect(out).toMatch(/MISSING\s+app/);
    expect(out).toMatch(/MISSING\s+nginx/);
  });

  it('exits 2 with NOT APPLICABLE when docker itself is unreachable', () => {
    const { code, out } = runGuard({}, { barePath: true });
    expect(code).toBe(2);
    expect(out).toContain('NOT APPLICABLE — docker is not reachable');
    expect(out).toContain('(0 inspected)');
  });
});

describe('#2332 the documented opt-out (the only path to exit 0 with 0 inspected)', () => {
  it('--allow-empty prints the skip and exits 0', () => {
    const { code, out } = runGuard({ all: [], live: [], compose: { app: {} } }, { args: ['--allow-empty'] });
    expect(code).toBe(0);
    expect(out).toContain('NOT APPLICABLE');
    expect(out).toContain('(skipped —');
  });

  it('RUNNING_CONFIG_ALLOW_EMPTY=1 behaves identically', () => {
    const { code, out } = runGuard({ all: [], live: [], compose: { app: {} } }, { extraEnv: { RUNNING_CONFIG_ALLOW_EMPTY: '1' } });
    expect(code).toBe(0);
    expect(out).toContain('NOT APPLICABLE');
    expect(out).toContain('(skipped —');
  });

  it('the opt-out never silences a real finding (exit 1 still wins)', () => {
    const state = {
      ...CLEAN_APP,
      containers: {
        'deploy-app-1': {
          ...CLEAN_APP.containers['deploy-app-1'],
          mounts: [['package.json', '/etc/app.conf']],
        },
      },
      exec: { 'deploy-app-1': { '/etc/app.conf': 'stale bytes the repo no longer holds' } },
    };
    const { code, out } = runGuard(state, { extraEnv: { RUNNING_CONFIG_ALLOW_EMPTY: '1' } });
    expect(code).toBe(1);
    expect(out).toContain('DRIFT');
  });
});

describe('#2332 service coverage (inspected < declared is drift, not silence)', () => {
  it('a declared service with no container at all fails naming it (AC)', () => {
    const { code, out } = runGuard({
      all: ['deploy-app-1'],
      live: ['deploy-app-1'],
      created: ['deploy-app-1'],
      compose: { app: {}, nginx: {} },
      containers: { 'deploy-app-1': { service: 'app', configFiles: '/x/docker-compose.yml', mounts: [] } },
      exec: {},
    });
    expect(code).toBe(1);
    expect(out).toMatch(/MISSING\s+nginx/);
    expect(out).toContain('up -d nginx');
  });

  it('a one-shot job that exited by design (minio-init pattern) is present, not missing', () => {
    const { code, out } = runGuard({
      all: ['deploy-app-1'],
      live: ['deploy-app-1'],
      created: ['deploy-app-1', 'deploy-minio-init-1'],
      compose: { app: {}, 'minio-init': {} },
      containers: {
        'deploy-app-1': { service: 'app', configFiles: '/x/docker-compose.yml', mounts: [] },
        'deploy-minio-init-1': { service: 'minio-init', configFiles: '/x/docker-compose.yml' },
      },
      exec: {},
    });
    expect(code).toBe(0);
    expect(out).not.toContain('MISSING');
    expect(out).toContain('inspected: 1 live container(s) covering 1 service(s) of 2 declared');
  });

  it('when the `-a` census fails and a declared service is not live, exit 2 — cannot tell exited-one-shot from absent', () => {
    const { code, out } = runGuard({
      all: ['deploy-app-1'],
      live: ['deploy-app-1'],
      failCensus: true,
      compose: { app: {}, nginx: {} },
      containers: { 'deploy-app-1': { service: 'app', configFiles: '/x/docker-compose.yml', mounts: [] } },
      exec: {},
    });
    expect(code).toBe(2);
    expect(out).toContain('NOT APPLICABLE');
    expect(out).toContain('census failed');
  });
});

describe('#2332 unreadable compose config is not a silent green', () => {
  it('live containers + compose config unparseable -> exit 2 naming the unchecked subject', () => {
    const { code, out } = runGuard({ ...CLEAN_APP, compose: null });
    expect(code).toBe(2);
    expect(out).toContain('NOT APPLICABLE');
    expect(out).toContain('resolved compose config unreadable');
  });

  it('the same state with --allow-empty exits 0 but still prints NOT APPLICABLE', () => {
    const { code, out } = runGuard({ ...CLEAN_APP, compose: null }, { args: ['--allow-empty'] });
    expect(code).toBe(0);
    expect(out).toContain('NOT APPLICABLE');
    expect(out).toContain('(skipped —');
  });
});

describe('#2332 no regression on the checks that already worked', () => {
  it('everything inspected and matching -> exit 0, with the inspected count in the summary', () => {
    const { code, out } = runGuard(CLEAN_APP);
    expect(code).toBe(0);
    expect(out).toContain('running-config drift: 0 identical · 0 drifted · 0 unchecked');
    expect(out).toContain('inspected: 1 live container(s) covering 1 service(s) of 1 declared');
  });

  it('a stale bind-mounted file still fails with the recreate hint', () => {
    const state = {
      ...CLEAN_APP,
      containers: {
        'deploy-app-1': {
          ...CLEAN_APP.containers['deploy-app-1'],
          mounts: [['package.json', '/etc/app.conf']],
        },
      },
      exec: { 'deploy-app-1': { '/etc/app.conf': 'stale bytes the repo no longer holds' } },
    };
    const { code, out } = runGuard(state);
    expect(code).toBe(1);
    expect(out).toContain('DRIFT  deploy-app-1');
    expect(out).toContain('the container is NOT serving the committed file');
    expect(out).toContain('up -d --force-recreate app');
  });

  it('an identical bind-mounted file is ok (bytes compared, not inodes)', () => {
    const pkg = readFileSync(resolve(ROOT, 'package.json'), 'utf8');
    const state = {
      ...CLEAN_APP,
      containers: {
        'deploy-app-1': {
          ...CLEAN_APP.containers['deploy-app-1'],
          mounts: [['package.json', '/etc/app.conf']],
        },
      },
      exec: { 'deploy-app-1': { '/etc/app.conf': pkg } },
    };
    const { code, out } = runGuard(state);
    expect(code).toBe(0);
    expect(out).toContain('running-config drift: 1 identical · 0 drifted · 0 unchecked');
  });

  it('an untagged release still fails', () => {
    const state = {
      ...CLEAN_APP,
      containers: {
        'deploy-app-1': { ...CLEAN_APP.containers['deploy-app-1'], env: ['PATH=/usr/bin'] },
      },
      exec: { 'deploy-app-1': { '/app/.next/BUILD_ID': 'build-1791041783' } },
    };
    const { code, out } = runGuard(state);
    expect(code).toBe(1);
    expect(out).toContain('UNTAGGED  deploy-app-1');
  });
});

describe('#2332 wiring — the guard is scheduled and its result recorded', () => {
  it('package.json keeps the guard:running-config npm script', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['guard:running-config']).toContain('check-running-config-drift.mjs');
  });

  it('nightly-soak.yml runs it with the container-less-runner opt-out and uploads the result', () => {
    const wf = readFileSync(resolve(ROOT, '.github/workflows/nightly-soak.yml'), 'utf8');
    expect(wf).toContain('guard:running-config');
    expect(wf).toContain('--allow-empty');
    expect(wf).toContain('running-config');
    expect(wf).toMatch(/upload-artifact[\s\S]*running-config/);
  });
});
