/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3252 — `deploy/nginx/nginx-production.conf` routes `/socket.io/` to an
 * upstream called `nucrm_realtime`, and `realtime.ts` is a long-lived process
 * that nothing on the pm2 host started. Every websocket handshake answered 502,
 * and because a 502 from an upstream connection failure is logged by nginx
 * rather than by the app, the app-side error pipeline never saw one of them.
 *
 * The point of this screen is that nothing in it hardcodes the name of the
 * process it expects. It reads the nginx config, takes the upstream and port
 * from the `/socket.io/` `proxy_pass`, and then demands that some pm2 app
 * starts an entry point bound to that port. An issue can be closed by mistake;
 * an upstream block cannot.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname!, '..', '..');
const load = createRequire(import.meta.url);

const NGINX = readFileSync(join(ROOT, 'deploy/nginx/nginx-production.conf'), 'utf8');
const ECO_SRC = readFileSync(join(ROOT, 'ecosystem.config.cjs'), 'utf8');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
const REALTIME_TS = readFileSync(join(ROOT, 'realtime.ts'), 'utf8');

interface Pm2App {
  name: string;
  script: string;
  args?: string;
  cwd?: string;
  env?: Record<string, string | number>;
  exec_mode?: string;
  instances?: string | number;
  merge_logs?: boolean;
  out_file?: string;
  error_file?: string;
}

const apps = (load(join(ROOT, 'ecosystem.config.cjs')) as { apps: Pm2App[] }).apps;

/** `nucrm_realtime` / 4001, taken from the config nginx actually loads. */
function socketIoUpstream(): { name: string; host: string; port: number } {
  const pass = /location\s+\/socket\.io\/\s*\{[^}]*?proxy_pass\s+http:\/\/([\w-]+);/.exec(NGINX);
  expect(pass, 'nginx no longer proxies /socket.io/ — re-read the premise of this test').not.toBeNull();
  const name = pass![1];
  const block = new RegExp(`upstream\\s+${name}\\s*\\{([\\s\\S]*?)\\}`).exec(NGINX);
  expect(block, `/socket.io/ proxies to undefined upstream ${name}`).not.toBeNull();
  const server = /server\s+([\w.-]+):(\d+)/.exec(block![1]);
  expect(server, `upstream ${name} declares no server host:port`).not.toBeNull();
  return { name, host: server![1], port: Number(server![2]) };
}

const UPSTREAM = socketIoUpstream();

/** The pm2 app that must exist: the one whose entry point is the file nginx means. */
function startedRealtime(): Pm2App {
  const found = apps.find((a) => (a.args ?? '').split(/\s+/).includes(`${UPSTREAM.host}.ts`));
  if (!found) {
    throw new Error(
      `nginx routes /socket.io/ to "${UPSTREAM.host}:${UPSTREAM.port}", but no pm2 app in ` +
        `ecosystem.config.cjs starts ${UPSTREAM.host}.ts — every handshake on that path 502s (#3252).`,
    );
  }
  return found;
}

describe('#3252 the premise — nginx really does route /socket.io/ somewhere', () => {
  it('names the realtime upstream the issue describes', () => {
    expect(UPSTREAM.name).toBe('nucrm_realtime');
    expect(UPSTREAM.host).toBe('realtime');
    expect(UPSTREAM.port).toBe(4001);
  });

  it('points at a process the repo actually contains', () => {
    expect(existsSync(join(ROOT, `${UPSTREAM.host}.ts`))).toBe(true);
    // the entry point binds this port itself, so the pm2 app cannot invent another
    expect(REALTIME_TS).toMatch(/process\.env\['REALTIME_PORT'\]\s*\?\?\s*4001/);
  });
});

describe('#3252 the pm2 host starts the process nginx proxies to', () => {
  it('declares an app whose entry point is realtime.ts', () => {
    expect(startedRealtime().script).toMatch(/tsx$/);
  });

  it('pins the port the nginx upstream targets, so proxy_pass and the bind agree', () => {
    expect(startedRealtime().env?.REALTIME_PORT).toBe(UPSTREAM.port);
  });

  it('binds loopback on the host, the same rule #1042 set for `web`', () => {
    // REALTIME_HOST defaults to 127.0.0.1 (realtime.ts:60), but a config that
    // never says it is a config that changes with the code. nginx is the only
    // public service here, so 4001 must not reach the VM's public interface.
    expect(startedRealtime().env?.REALTIME_HOST).toBe('127.0.0.1');
    expect(REALTIME_TS).toMatch(/process\.env\['REALTIME_HOST'\]\s*\|\|\s*'127\.0\.0\.1'/);
  });

  it('runs one forked instance — socket.io rooms are shared through Redis, not process memory', () => {
    const app = startedRealtime();
    expect(app.exec_mode).toBe('fork');
    expect(Number(app.instances)).toBe(1);
  });
});

describe('#3252 the new app inherits the traps the other sidecars already died on', () => {
  it('preloads .env.local, or it starts with an empty environment (#3251)', () => {
    // Same shape as worker/cron: `--import ./scripts/load-env.mjs <entry>`.
    expect(startedRealtime().args).toMatch(/^--import \.\/scripts\/load-env\.mjs \S*realtime\.ts$/);
  });

  it('resolves Redis from the host, not from the Docker network name in .env.local', () => {
    // .env.local on this VM carries REDIS_URL=redis://redis; that name does not
    // resolve on the host, and a sidecar that trusts it silently retries a
    // hostname into the ground.
    expect(String(startedRealtime().env?.REDIS_URL)).toMatch(/^redis:\/\/127\.0\.0\.1:6379$/);
  });

  it('sets merge_logs, or its declared log file never exists (#3253)', () => {
    const app = startedRealtime();
    expect(app.merge_logs).toBe(true);
    expect(app.out_file).toMatch(/realtime-out\.log$/);
    expect(app.error_file).toMatch(/realtime-error\.log$/);
  });
});

describe('#3252 starting it is not enough — the deploy has to roll it onto each build', () => {
  it('lists it among the background apps deploy.yml restarts (#2300)', () => {
    const bg = /BG_APPS="([^"]+)"/.exec(WORKFLOW);
    expect(bg, 'deploy.yml lost its BG_APPS line').not.toBeNull();
    expect(bg![1].split(/\s+/)).toContain(startedRealtime().name);
  });

  it('names every app in the config, web except', () => {
    // The #2300 failure was a rollout that covered one app and shipped the rest
    // stale; deriving the expectation from the config means a fifth app cannot
    // be added to one file and forgotten in the other.
    const bg = /BG_APPS="([^"]+)"/.exec(WORKFLOW)![1].split(/\s+/).sort();
    const expected = apps.map((a) => a.name).filter((n) => n !== 'web').sort();
    expect(bg).toEqual(expected);
  });

  it('does not leave the workflow claiming three apps it no longer has', () => {
    const claim = /ecosystem\.config\.cjs declares (\w+) apps \(([^)]*)\)/.exec(WORKFLOW);
    if (!claim) return; // no claim is not a wrong claim
    expect(Number(claim![1])).toBe(apps.length - 1);
    expect(claim![2].split(',').map((s) => s.trim())).toEqual(apps.map((a) => a.name).filter((n) => n !== 'web'));
  });
});

describe('#3252 the config still describes itself honestly after the addition', () => {
  it('has no app reading a key PM2 ignores', () => {
    expect(ECO_SRC).not.toMatch(/^\s*env_file\s*:/m);
  });

  it('does not count its apps in prose that the array has outgrown', () => {
    // The header enumerated "the two `tsx` processes" and "all three apps".
    // A claim that drifts from the array is how deploy.yml came to restart two
    // of three — an operator reads the sentence, not the file.
    const tsxApps = apps.filter((a) => /tsx$/.test(a.script)).map((a) => a.name);
    expect(ECO_SRC).not.toMatch(/all three apps/);
    const proseTsxCount = /the (one|two|three|four) `tsx` processes \(([^)]*)\)/.exec(ECO_SRC);
    if (proseTsxCount) {
      expect(proseTsxCount![2].split(',').map((s) => s.trim())).toEqual(tsxApps);
    }
    expect(new Set(apps.map((a) => a.name)).size).toBe(apps.length);
  });
});
