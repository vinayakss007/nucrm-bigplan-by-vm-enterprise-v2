/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3276 — the file-descriptor limit is one fact with three surfaces.
 *
 * `worker_rlimit_nofile 65535;` is a *request*. nginx raises a worker's soft limit only
 * as far as the hard limit its supervisor granted the process; when the grant is smaller
 * it logs `setrlimit(RLIMIT_NOFILE, 65535) failed (13: Permission denied)` once per worker
 * and then serves anyway — on 1024 descriptors per worker while the config under review
 * says 65535. That is exactly what the host did, four times, in a log nobody read.
 *
 * So the number lives in three files that this repo owns and nothing compared:
 *   - `deploy/nginx/nginx-production.conf` (the directive),
 *   - `deploy/systemd/nginx.service.d/limits.conf` (the host's grant), and
 *   - the `ulimits:` block of the `nginx` service in `deploy/docker-compose.production.yml`
 *     (the container's grant).
 *
 * Plus two pieces of nginx's own arithmetic that were true by accident: a proxied
 * connection costs two descriptors (client + upstream), so the limit must cover
 * `2 * worker_connections`; and `soft` must not exceed `hard`, because compose accepts
 * that shape happily and nginx then cannot raise the soft limit at all.
 *
 * The screen is fail-closed on its environment, so half of these tests plant a *broken
 * reading* (missing file, missing directive, unparseable block) rather than a broken
 * number: a guard that cannot see the limits must not report "consistent". Deleting a
 * surface is therefore not an escape from this file, which is the point of #3276.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  SURFACES,
  check,
  parseComposeUlimits,
  parseLimitNofile,
  parseWorkerConnections,
  parseWorkerRlimit,
  type SurfaceName,
} from '../../scripts/check-nginx-fd-limit.mts';

const ROOT = resolve(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-nginx-fd-limit.mts');

const dir = mkdtempSync(join(tmpdir(), 'nginx-fd-3276-vm-'));
let n = 0;

const CONF = `user nginx;\nworker_processes auto;\nworker_rlimit_nofile 65535;\nevents {\n    worker_connections 4096;\n}\nhttp {\n    server {\n        listen 80;\n    }\n}\n`;
const UNIT = '[Service]\nLimitNOFILE=65535\n';
const COMPOSE =
  'services:\n' +
  '  nginx:\n' +
  '    image: nginx:1.27-alpine\n' +
  '    ulimits:\n' +
  '      nofile:\n' +
  '        soft: 65535\n' +
  '        hard: 65535\n' +
  '    ports:\n' +
  '      - "80:80"\n' +
  '  app:\n' +
  '    image: nucrm-app\n' +
  '    ulimits:\n' +
  '      nofile:\n' +
  '        soft: 1024\n' +
  '        hard: 1024\n';

/**
 * A fixture root with all three surfaces present and agreeing, then each named surface
 * replaced (`null` deletes it, which must read as a finding and not as "nothing to check").
 * `compose` is spliced, not replaced, so the `app:` service keeps existing and the block
 * parser is still forced to stop at the right line.
 */
function tree(overrides: Partial<Record<SurfaceName, string | null>> = {}): string {
  const sub = join(dir, `case-${n++}`);
  const files: Record<string, string | null> = {
    [SURFACES.conf]: CONF,
    [SURFACES.unit]: UNIT,
    [SURFACES.compose]: COMPOSE,
  };
  for (const [name, text] of Object.entries(overrides) as [SurfaceName, string | null][]) {
    files[SURFACES[name]] = text;
  }
  for (const [rel, text] of Object.entries(files)) {
    const full = join(sub, rel);
    mkdirSync(dirname(full), { recursive: true });
    if (text === null) continue;
    writeFileSync(full, text);
  }
  return sub;
}

const composeNginx = (ulimitsBlock: string) =>
  COMPOSE.replace(
    '    ulimits:\n      nofile:\n        soft: 65535\n        hard: 65535\n',
    ulimitsBlock,
  );

function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args, root], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

const surfacesOf = (root: string) => check(root).findings.map((f) => f.surface);
const detailOf = (root: string, surface: string) =>
  check(root)
    .findings.filter((f) => f.surface === surface)
    .map((f) => f.detail)
    .join('\n');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('#3276 the three surfaces are read', () => {
  it('parses the nginx directive, semicolon included', () => {
    expect(parseWorkerRlimit(CONF)).toBe(65535);
    // The semicolon is part of the directive; a commented-out or truncated line is not a
    // request nginx will make, so the screen must not credit it.
    expect(parseWorkerRlimit('worker_rlimit_nofile 65535')).toBeNull();
    expect(parseWorkerRlimit('# worker_rlimit_nofile 65535;')).toBeNull();
    expect(parseWorkerConnections(CONF)).toBe(4096);
  });

  it('parses the systemd grant and refuses a spelling it cannot compare', () => {
    expect(parseLimitNofile(UNIT)).toBe(65535);
    expect(parseLimitNofile('[Service]\nLimitNOFILE=1024\n')).toBe(1024);
    // `infinity` is a legal systemd value but not a number, and "one fact across three
    // surfaces" needs a number on all three. Fail closed rather than invent an equivalent.
    expect(parseLimitNofile('[Service]\nLimitNOFILE=infinity\n')).toBeNull();
  });

  it('reads only the nginx service out of the compose file', () => {
    expect(parseComposeUlimits(COMPOSE)).toEqual({ soft: 65535, hard: 65535 });
    // The `app:` service two blocks down grants 1024; taking its number would be a
    // different service's grant and a wrong verdict in both directions.
    expect(parseComposeUlimits(composeNginx(''))).toEqual({ soft: null, hard: null });
    expect(parseComposeUlimits('services:\n  app:\n    image: nucrm-app\n')).toBeNull();
    expect(parseComposeUlimits('services:\n  nginx:\n    image: nginx:1.27-alpine\n  app:\n')).toEqual({
      soft: null,
      hard: null,
    });
    expect(parseComposeUlimits(composeNginx('    ulimits:\n      nofile:\n        soft: 65535\n'))).toEqual({
      soft: 65535,
      hard: null,
    });
  });

  it('agrees on the tree it ships', () => {
    const verdict = check(ROOT);
    expect(verdict.findings).toEqual([]);
    expect(verdict.values).toEqual({ conf: 65535, unit: 65535, compose: 65535 });
    expect(verdict.connections).toBe(4096);
  });
});

describe('#3276 a broken reading is a finding, not a skip', () => {
  it('fails closed when a surface is gone', () => {
    expect(surfacesOf(tree({ unit: null }))).toEqual(['unit']);
    expect(detailOf(tree({ unit: null }), 'unit')).toContain('missing');
    expect(surfacesOf(tree({ conf: null }))).toEqual(['conf']);
    // conf gone means its number cannot be compared at all: agreement stays silent, but
    // the missing file is fatal on its own surface, so the run still fails.
    expect(run(tree({ conf: null })).status).toBe(1);
    expect(surfacesOf(tree({ compose: null }))).toEqual(['compose']);
  });

  it('fails closed when a surface is present but says nothing', () => {
    expect(detailOf(tree({ conf: 'events {\n  worker_connections 4096;\n}\n' }), 'conf')).toContain(
      'worker_rlimit_nofile',
    );
    expect(detailOf(tree({ conf: 'worker_rlimit_nofile 65535;\n' }), 'conf')).toContain('worker_connections');
    expect(detailOf(tree({ unit: '[Service]\nRestart=always\n' }), 'unit')).toContain('LimitNOFILE');
    expect(detailOf(tree({ compose: 'services:\n  app:\n    image: x\n' }), 'compose')).toContain('nginx');
    expect(detailOf(tree({ compose: composeNginx('') }), 'compose')).toContain('incomplete');
  });

  it('does not let an incomplete ulimit masquerade as agreement', () => {
    const root = tree({ compose: composeNginx('    ulimits:\n      nofile:\n        soft: 65535\n') });
    expect(surfacesOf(root)).toContain('compose');
    expect(surfacesOf(root)).not.toContain('agreement');
  });
});

describe('#3276 the numbers have to agree and have to cover the config', () => {
  it('catches the exact failure the host had: the unit grants 1024 under a 65535 request', () => {
    const root = tree({ unit: '[Service]\nLimitNOFILE=1024\n' });
    expect(detailOf(root, 'agreement')).toContain('conf=65535 unit=1024 compose.soft=65535');
  });

  it('catches a compose grant below the conf while the unit still agrees', () => {
    const root = tree({ compose: composeNginx('    ulimits:\n      nofile:\n        soft: 2048\n        hard: 65535\n') });
    expect(surfacesOf(root)).toEqual(['agreement']);
  });

  it('catches soft above hard, which compose accepts and nginx cannot use', () => {
    const root = tree({ compose: composeNginx('    ulimits:\n      nofile:\n        soft: 65536\n        hard: 65535\n') });
    const detail = detailOf(root, 'compose');
    expect(detail).toContain('soft 65536 exceeds hard 65535');
    // The comparison is against `soft`, the limit the worker actually starts on; a legal
    // but useless `soft == hard` stays clean.
    expect(surfacesOf(tree({ compose: composeNginx('    ulimits:\n      nofile:\n        soft: 65535\n        hard: 1048576\n') }))).toEqual([]);
  });

  it("applies nginx's two-descriptors-per-proxied-connection arithmetic", () => {
    // 2 * 4096 = 8192: a limit under that cannot hold every worker_connections entry with
    // its upstream half, so the config is inconsistent with itself even when all three
    // surfaces print the same number.
    const low = '    ulimits:\n      nofile:\n        soft: 8191\n        hard: 8191\n';
    const root = tree({
      conf: 'worker_rlimit_nofile 8191;\nevents {\n    worker_connections 4096;\n}\n',
      unit: '[Service]\nLimitNOFILE=8191\n',
      compose: composeNginx(low),
    });
    // All three agree, so only nginx's own arithmetic is left to fail.
    expect(surfacesOf(root)).toEqual(['conf']);
    expect(detailOf(root, 'conf')).toContain('below 2 * worker_connections 4096 = 8192');
    expect(
      surfacesOf(
        tree({
          conf: 'worker_rlimit_nofile 8192;\nevents {\n    worker_connections 4096;\n}\n',
          unit: '[Service]\nLimitNOFILE=8192\n',
          compose: composeNginx('    ulimits:\n      nofile:\n        soft: 8192\n        hard: 8192\n'),
        }),
      ),
    ).toEqual([]);
  });

  it('stays quiet about agreement while its own surface is unread', () => {
    const root = tree({ unit: '[Service]\nRestart=always\n' });
    expect(surfacesOf(root)).toEqual(['unit']);
  });
});

describe('#3276 the CLI reports what the screen found', () => {
  it('passes a consistent tree', () => {
    const r = run(tree());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('conf=65535 unit=65535 compose=65535 (connections=4096)');
    expect(r.stdout).toContain('OK: one number across the conf');
  });

  it('fails a drifted tree and names the surface on stderr', () => {
    const r = run(tree({ unit: '[Service]\nLimitNOFILE=1024\n' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('[agreement]');
    expect(r.stderr).toContain('3276');
  });

  it('prints the same verdict through --json as the in-process check', () => {
    const root = tree({ compose: composeNginx('    ulimits:\n      nofile:\n        soft: 65536\n        hard: 65535\n') });
    const json = JSON.parse(run(root, '--json').stdout);
    expect(json.findings).toEqual(check(root).findings);
    expect(json.values).toEqual(check(root).values);
    expect(json.connections).toBe(4096);
    expect(json.root).toBe(root);
  });

  it('exits non-zero from the repo root, which is what CI runs', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK:');
  });
});
