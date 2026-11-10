/**
 * #3264 — rootless Podman has no live supervisor. `--restart unless-stopped`
 * is honoured once by `podman-restart.service`; a container that dies later
 * stays dead, and pm2 only supervises the app processes. These units are the
 * watchdog, and the two traps that make a naive version silently useless are
 * asserted here: `OnUnitActiveSec` never re-arms a oneshot, and the default
 * cgroup kill mode SIGKILLs the rootless port forwarder.
 */
import { describe, it, expect } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'deploy/systemd/start-containers.sh');
const SERVICE = readFileSync(join(ROOT, 'deploy/systemd/nucrm-containers.service'), 'utf8');
const TIMER = readFileSync(join(ROOT, 'deploy/systemd/nucrm-containers.timer'), 'utf8');
const README = readFileSync(join(ROOT, 'deploy/systemd/README.md'), 'utf8');
// The timer's header names the trap it avoids, so structural assertions read the
// live unit only — a comment must not be able to turn a check red or green.
const TIMER_CODE = TIMER.replace(/^\s*#.*$/gm, '');

const FAKE_PODMAN = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${FAKE_LOG:?}"
case "\${1:-}" in
  ps)
    if [ "\${2:-}" = "-a" ]; then cat "\${FAKE_ALL:?}"; else cat "\${FAKE_RUNNING:?}"; fi
    ;;
  start)
    if [ -f "\${FAKE_FAIL:-}" ] && grep -qxF "\${2:-}" "\${FAKE_FAIL}"; then
      exit 1
    fi
    ;;
esac
`;

type Run = { code: number | null; out: string; calls: string[] };

function runWatchdog(opts: { all: string[]; running: string[]; fail?: string[] }): Run {
  const dir = mkdtempSync(join(tmpdir(), 'nucrm-watchdog-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const allFile = join(dir, 'all');
  const runningFile = join(dir, 'running');
  const failFile = join(dir, 'fail');
  const log = join(dir, 'calls');
  writeFileSync(allFile, opts.all.map((n) => `${n}\n`).join(''));
  writeFileSync(runningFile, opts.running.map((n) => `${n}\n`).join(''));
  writeFileSync(failFile, (opts.fail ?? []).map((n) => `${n}\n`).join(''));
  writeFileSync(log, '');
  writeFileSync(join(bin, 'podman'), FAKE_PODMAN);
  chmodSync(join(bin, 'podman'), 0o755);

  const res = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: dir,
      FAKE_LOG: log,
      FAKE_ALL: allFile,
      FAKE_RUNNING: runningFile,
      FAKE_FAIL: failFile,
    },
  });
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  rmSync(dir, { recursive: true, force: true });
  return { code: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}`, calls };
}

describe('the watchdog script derives its container list (#3264)', () => {
  it('starts every stopped nucrm-* container and leaves running/foreign ones alone', () => {
    const r = runWatchdog({
      all: ['nucrm-app', 'nucrm-db', 'nucrm-redis', 'other-app'],
      running: ['nucrm-app'],
    });
    expect(r.code, r.out).toBe(0);
    expect(r.calls).toContain('start nucrm-db');
    expect(r.calls).toContain('start nucrm-redis');
    expect(r.calls).not.toContain('start nucrm-app');
    expect(r.calls).not.toContain('start other-app');
    expect(r.out).toMatch(/started=2 failed=0/);
  });

  it('is a no-op when no nucrm container exists, not a failed timer run', () => {
    const r = runWatchdog({ all: [], running: [] });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/no nucrm-\* containers/);
    expect(r.calls.some((c) => c.startsWith('start '))).toBe(false);
  });

  it('tries the remaining containers and exits non-zero when one start fails', () => {
    const r = runWatchdog({ all: ['nucrm-a', 'nucrm-b'], running: [], fail: ['nucrm-a'] });
    expect(r.code).toBe(1);
    expect(r.calls).toContain('start nucrm-a');
    expect(r.calls).toContain('start nucrm-b');
    expect(r.out).toMatch(/failed=1/);
  });

  it('reads names from podman instead of an allow-list that can go stale', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).toMatch(/podman ps -a --format '\{\{\.Names\}\}'/);
    expect(script).toMatch(/grep -E '\^nucrm-'/);
    // No hard-coded container names: a new nucrm-* service must be covered
    // without editing the unit.
    expect(script).not.toMatch(/nucrm-(app|db|redis|worker|nginx)\b/);
  });
});

describe('the units encode the two traps that make a watchdog useless (#3264)', () => {
  it('uses OnUnitInactiveSec, because a oneshot never becomes active again', () => {
    expect(TIMER_CODE).toMatch(/OnUnitInactiveSec=2min/);
    expect(TIMER_CODE).not.toMatch(/OnUnitActiveSec/);
    expect(TIMER_CODE).toMatch(/OnBootSec=2min/);
  });

  it('sets KillMode=process so stopping the oneshot cannot SIGKILL the port forwarder', () => {
    expect(SERVICE).toMatch(/Type=oneshot/);
    expect(SERVICE).toMatch(/KillMode=process/);
  });

  it('writes to a file, because the host has no user journal', () => {
    expect(SERVICE).toMatch(/StandardOutput=append:/);
    expect(SERVICE).toMatch(/StandardError=append:/);
    expect(SERVICE).toMatch(/\.local\/state\/nucrm-containers\.log/);
  });

  it('is installed as a user unit and documented with linger', () => {
    expect(README).toContain('systemctl --user enable --now nucrm-containers.timer');
    expect(README).toMatch(/loginctl enable-linger/);
    expect(README).toMatch(/OnUnitInactiveSec/);
    expect(README).toMatch(/KillMode=process/);
  });
});
