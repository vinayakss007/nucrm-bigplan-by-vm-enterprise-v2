/**
 * #1036 — the firewall script has to speak the firewall the host actually runs.
 *
 * The host this repo is deployed on is Oracle Linux 9, where `firewalld` is the
 * running backend and UFW is not in the base repositories. The script used to
 * be UFW-only: `auto` meant "install ufw", and `dnf install -y ufw` fails on
 * that host, leaving the public zone exactly as it was — `3000/tcp`, `4001/tcp`
 * and `rdp` open. `infra-readiness.sh` had the same blind spot: it only read
 * `ufw status`, so a firewalld host was reported as "ufw not installed" and a
 * genuinely exposed zone was never named.
 *
 * These tests run the scripts against fake `firewall-cmd` / `ufw` / `iptables`
 * binaries, so they measure the commands the scripts would execute rather than
 * quoting the source. `--dry-run` is the seam that makes that possible without
 * root or a disposable VM: mutating commands are printed, never executed.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'deploy/scripts/setup-firewall.sh');
const READINESS = join(ROOT, 'deploy/scripts/infra-readiness.sh');

let dir = '';
let log = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'firewalld-1036-'));
  log = join(dir, 'commands.log');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write an executable fake command into `binDir`. */
function fake(binDir: string, name: string, body: string): void {
  const file = join(binDir, name);
  // A symlink from minimalBin() may already occupy the name; writing through it
  // would overwrite the real host binary, so remove it first.
  rmSync(file, { force: true });
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
}

/** Symlink a real command into `binDir` so a restricted PATH still works. */
function link(binDir: string, name: string): void {
  const real = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (real) symlinkSync(real, join(binDir, name));
}

/**
 * A PATH with only `binDir`: `command -v` cannot fall through to the host's
 * real firewalld/UFW, which is what makes "this host has neither" testable.
 */
function minimalBin(commands: string[]): string {
  const bin = mkdtempSync(join(dir, 'bin-'));
  for (const name of commands) link(bin, name);
  return bin;
}

const CORE = ['grep', 'awk', 'head', 'cat', 'sed', 'tr', 'dirname'];

/** A fake firewalld whose zone state is supplied per test. */
function firewalldBin(opts: {
  target?: string;
  ports?: string;
  services?: string;
  rich?: string;
  state?: string;
  withIptables?: boolean;
} = {}): string {
  const bin = minimalBin([...CORE, 'systemctl']);
  fake(bin, 'systemctl', `printf 'systemctl %s\\n' "$*" >> "${log}"\nexit 0`);
  fake(bin, 'firewall-cmd', `
printf 'firewall-cmd %s\\n' "$*" >> "${log}"
case "$*" in
  "--state") printf '%s\\n' "${opts.state ?? 'running'}" ;;
  "--get-default-zone") printf 'public\\n' ;;
  "--get-zone-of-interface="*) printf 'public\\n' ;;
  *"--list-ports"*) printf '%s\\n' "${opts.ports ?? ''}" ;;
  *"--list-services"*) printf '%s\\n' "${opts.services ?? 'ssh'}";;
  *"--list-rich-rules"*) printf '%s\\n' "${opts.rich ?? ''}" ;;
  *"--get-target"*) printf '%s\\n' "${opts.target ?? 'default'}" ;;
  *"--list-all"*) printf 'public (active)\\n' ;;
esac
exit 0`);
  if (opts.withIptables !== false) {
    fake(bin, 'iptables', `printf 'iptables %s\\n' "$*" >> "${log}"\nexit 0`);
  }
  return bin;
}

/** A fake UFW that reports `Status: active`. */
function ufwBin(): string {
  const bin = minimalBin([...CORE, 'systemctl']);
  fake(bin, 'systemctl', `printf 'systemctl %s\\n' "$*" >> "${log}"\nexit 0`);
  fake(bin, 'ufw', `
printf 'ufw %s\\n' "$*" >> "${log}"
case "$1" in
  status) printf 'Status: active\\n' ;;
esac
exit 0`);
  fake(bin, 'iptables', `printf 'iptables %s\\n' "$*" >> "${log}"\nexit 0`);
  return bin;
}

function run(args: string[], path: string, extraEnv: Record<string, string> = {}) {
  const r = spawnSync('/bin/bash', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: path,
      HOME: process.env.HOME ?? '',
      FW_LOG: log,
      ...extraEnv,
    },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function readLog(): string {
  return existsSync(log) ? readFileSync(log, 'utf8') : '';
}

function resetLog(): void {
  writeFileSync(log, '');
}

describe('#1036 setup-firewall.sh backend detection', () => {
  it('auto-selects a running firewalld and removes the ports the host exposed', () => {
    resetLog();
    const bin = firewalldBin({ ports: '3000/tcp 4001/tcp', services: 'dhcpv6-client rdp ssh' });
    const r = run(['--dry-run', '--iface', 'enp0s5'], bin);

    expect(r.status).toBe(0);
    expect(r.out).toContain('Firewall backend: firewalld');
    expect(r.out).toContain('removing port 3000/tcp');
    expect(r.out).toContain('removing port 4001/tcp');
    expect(r.out).toContain('removing service rdp');
    expect(r.out).toContain('--remove-port=3000/tcp');
    expect(r.out).toContain('--remove-service=rdp');
    expect(r.out).toContain('--add-service=http');
    expect(r.out).toContain('--add-service=https');
    expect(r.out).toContain('firewall-cmd --reload');
    expect(r.out).not.toContain('dnf install');
    expect(r.out).not.toContain('apt-get install');
  });

  it('does not execute mutating commands in --dry-run', () => {
    resetLog();
    const bin = firewalldBin({ ports: '3000/tcp', services: 'rdp ssh' });
    const r = run(['--dry-run', '--iface', 'enp0s5'], bin);

    expect(r.status).toBe(0);
    const executed = readLog();
    expect(executed).toContain('firewall-cmd --state');
    expect(executed).not.toMatch(/firewall-cmd .*--permanent/);
    expect(executed).not.toContain('--reload');
    expect(executed).not.toMatch(/systemctl (enable|start)/);
  });

  it('keeps a non-default SSH port and closes port 22', () => {
    resetLog();
    const bin = firewalldBin({ services: 'ssh' });
    const r = run(['--dry-run', '--iface', 'enp0s5', '--ssh-port', '2222'], bin);

    expect(r.status).toBe(0);
    expect(r.out).toContain('--remove-service=ssh');
    expect(r.out).toContain('--add-port=2222/tcp');
    expect(r.out).not.toContain('--add-service=ssh');
  });

  it('repairs an ACCEPT zone target, which otherwise makes port removal meaningless', () => {
    resetLog();
    const bin = firewalldBin({ target: 'ACCEPT' });
    const r = run(['--dry-run', '--iface', 'enp0s5'], bin);

    expect(r.status).toBe(0);
    expect(r.out).toContain('Zone target is ACCEPT');
    expect(r.out).toContain('--set-target=default');
  });

  it('picks firewalld on a RHEL-family host that has neither firewall installed', () => {
    resetLog();
    const bin = minimalBin([...CORE, 'systemctl', 'ip']);
    fake(bin, 'ip', `printf 'default via 10.0.0.1 dev enp0s5 proto dhcp metric 100\\n'`);
    fake(bin, 'dnf', `printf 'dnf %s\\n' "$*" >> "${log}"\nexit 0`);
    fake(bin, 'systemctl', `printf 'systemctl %s\\n' "$*" >> "${log}"\nexit 0`);
    // No firewall-cmd / ufw anywhere on this PATH: auto must choose the
    // platform default instead of trying `dnf install -y ufw`.
    const r = run(['--dry-run'], bin);

    expect(r.status).toBe(0);
    expect(r.out).toContain('Firewall backend: firewalld');
    expect(r.out).toContain('dnf install -y firewalld');
    expect(r.out).not.toContain('dnf install -y ufw');
  });

  it('auto-selects UFW when UFW is the running backend', () => {
    resetLog();
    const bin = ufwBin();
    const r = run(['--dry-run', '--iface', 'ens3'], bin);

    expect(r.status).toBe(0);
    expect(r.out).toContain('Firewall backend: ufw');
    expect(r.out).toContain('ufw default deny incoming');
    expect(r.out).toContain('ufw allow 80/tcp');
    expect(r.out).toContain('ufw allow 443/tcp');
    expect(r.out).not.toContain('firewall-cmd');
  });

  it('rejects an unknown backend instead of silently choosing one', () => {
    const bin = firewalldBin();
    const r = run(['--dry-run', '--backend', 'iptables'], bin);
    expect(r.status).toBe(2);
    expect(r.out).toContain('--backend must be auto, ufw or firewalld');
  });

  it('warns about rich rules instead of claiming a clean zone', () => {
    resetLog();
    const bin = firewalldBin({
      rich: 'rule family="ipv4" port port="5432" protocol="tcp" accept',
    });
    const r = run(['--dry-run', '--iface', 'enp0s5'], bin);

    expect(r.status).toBe(0);
    expect(r.out).toContain('has rich rules this script does not modify');
    expect(r.out).toContain('port port=5432');
  });

  it('names the real external NIC in the Docker bypass rule', () => {
    resetLog();
    const bin = firewalldBin();
    const r = run(['--dry-run', '--iface', 'enp0s5'], bin);

    expect(r.status).toBe(0);
    expect(r.out).toContain('iptables -A DOCKER-USER ! -i enp0s5 -j RETURN');
    expect(r.out).not.toContain('! -i eth0 -j RETURN');
  });
});

describe('#1036 infra-readiness.sh firewall check', () => {
  function readiness(path: string, extraEnv: Record<string, string> = {}) {
    const r = spawnSync('/bin/bash', [READINESS], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        PATH: path,
        HOME: process.env.HOME ?? '',
        NODE_ENV: 'production',
        ...extraEnv,
      },
    });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }

  it('fails a firewalld zone that exposes the app, realtime and RDP', () => {
    const bin = firewalldBin({ ports: '3000/tcp 4001/tcp', services: 'dhcpv6-client rdp ssh' });
    const r = readiness(bin);

    expect(r.status).toBe(1);
    expect(r.out).toContain('firewalld zone public exposes');
    expect(r.out).toContain('ports: 3000/tcp 4001/tcp');
    expect(r.out).toContain('services: rdp');
    expect(r.out).toContain('setup-firewall.sh --backend firewalld');
  });

  it('passes a firewalld zone limited to SSH/HTTP/HTTPS', () => {
    const bin = firewalldBin({ ports: '', services: 'dhcpv6-client http https ssh' });
    const r = readiness(bin);

    expect(r.out).toContain('firewalld zone public allows only SSH/HTTP/HTTPS');
    expect(r.out).not.toContain('firewalld zone public exposes');
  });

  it('does not call a running firewalld host "ufw not installed"', () => {
    const bin = firewalldBin({ ports: '', services: 'http https ssh' });
    const r = readiness(bin);
    expect(r.out).not.toContain('ufw not installed');
    expect(r.out).not.toContain('neither firewalld nor ufw');
  });

  it('falls through to an active UFW when firewalld is installed but stopped', () => {
    const bin = firewalldBin({ state: 'not running' });
    fake(bin, 'ufw', `
printf 'ufw %s\\n' "$*" >> "${log}"
case "$1" in
  status) printf 'Status: active\\n' ;;
esac
exit 0`);
    const r = readiness(bin);

    expect(r.out).toContain('ufw active');
    expect(r.out).not.toContain('firewalld installed but NOT running');
  });

  it('fails a stopped firewalld when no other backend is active', () => {
    const bin = firewalldBin({ state: 'not running' });
    const r = readiness(bin);

    expect(r.status).toBe(1);
    expect(r.out).toContain('firewalld installed but NOT running');
  });
});

describe('#1036 documentation points at the backend that exists', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  it('the runbook and deployment guide name firewalld', () => {
    expect(read('docs/runbooks/go-live.md')).toContain('firewalld');
    expect(read('deploy/DEPLOYMENT_INTERNAL.md')).toContain('firewalld');
    expect(read('deploy/LAUNCH_RUNBOOK.md')).toContain('firewalld');
  });

  it('the script documents --backend and --dry-run', () => {
    const script = read('deploy/scripts/setup-firewall.sh');
    expect(script).toContain('--backend');
    expect(script).toContain('--dry-run');
    expect(script).toContain('firewall-cmd');
  });
});
