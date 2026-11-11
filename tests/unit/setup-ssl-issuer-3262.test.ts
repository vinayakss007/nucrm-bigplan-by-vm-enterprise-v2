/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// #3262 — setup-ssl.sh could only reach a certificate through `docker compose
// exec`, so it could not mint TLS material on a Podman host or on the pm2
// production VM. The fix separates "who runs certbot/openssl" from "compute the
// SAN set": --issuer docker|podman|openssl. This test executes the openssl path
// end-to-end (no daemon, no container) and asserts the container issuers are
// still selectable, because the container path is what the compose host uses.

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'deploy', 'scripts', 'setup-ssl.sh');
const SRC = readFileSync(SCRIPT, 'utf8');

function runIsolated(extraEnv: NodeJS.ProcessEnv, args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'nucrm-ssl-issuer-'));
  // A fake docker/podman on PATH proves the openssl path never shells out to a
  // container engine: if it does, the marker exists and the command fails.
  const bin = join(dir, 'bin');
  const marker = join(dir, 'container-engine-called');
  execFileSync('mkdir', ['-p', bin]);
  for (const engine of ['docker', 'podman', 'podman-compose']) {
    const fake = join(bin, engine);
    writeFileSync(fake, `#!/bin/sh\necho called > '${marker}'\nexit 42\n`);
    chmodSync(fake, 0o755);
  }
  const sslDir = join(dir, 'tls');
  const result = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SSL_DIR: sslDir, ...extraEnv },
  });
  return { result, dir, sslDir, marker };
}

const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' });
const haveOpenssl = openssl.status === 0;

describe('setup-ssl.sh offers the issuer the host actually has (#3262)', () => {
  it('documents and parses --issuer docker|podman|openssl', () => {
    expect(SRC).toMatch(/--issuer podman/);
    expect(SRC).toMatch(/--issuer openssl/);
    expect(SRC).toMatch(/--issuer\)/);
    for (const issuer of ['docker', 'podman', 'openssl']) {
      expect(SRC).toMatch(new RegExp(`\\b${issuer}\\b`));
    }
  });

  it('keeps docker as the default, so the compose host behaves as before', () => {
    expect(SRC).toMatch(/ENGINE="\$\{SSL_ISSUER:-docker\}"/);
    expect(SRC).toMatch(/COMPOSE="docker compose -f docker-compose\.production\.yml"/);
  });

  it('supports both podman compose providers instead of assuming a daemon', () => {
    expect(SRC).toMatch(/podman compose version/);
    expect(SRC).toMatch(/podman-compose/);
    expect(SRC).toMatch(/no compose provider/);
  });

  it('rejects an unknown issuer instead of silently falling back to docker', () => {
    const { result } = runIsolated({}, ['--issuer', 'borg']);
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Unknown issuer 'borg'/);
  });
});

(haveOpenssl ? describe : describe.skip)('--issuer openssl mints a usable cert without a container (#3262)', () => {
  const IP = '203.0.113.9';
  const { result, sslDir, marker } = runIsolated(
    { DOMAIN: IP, ACME_EMAIL: '' },
    ['--issuer', 'openssl', '--self-signed'],
  );

  it('succeeds with no docker/podman on PATH', () => {
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(marker), 'openssl path invoked a container engine').toBe(false);
    expect(`${result.stdout}${result.stderr}`).toMatch(/host openssl/);
  });

  it('writes the cert and the stable live/nucrm symlink under SSL_DIR', () => {
    const live = join(sslDir, 'live');
    const cert = join(live, 'self-signed', 'fullchain.pem');
    expect(existsSync(cert)).toBe(true);
    expect(lstatSync(join(live, 'nucrm')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(live, 'nucrm'))).toBe(join(live, 'self-signed'));
  });

  it('puts an IP SAN on the certificate, not just a CN', () => {
    const text = execFileSync(
      'openssl',
      ['x509', '-in', join(sslDir, 'live', 'self-signed', 'fullchain.pem'), '-noout', '-text'],
      { encoding: 'utf8' },
    );
    expect(text).toMatch(new RegExp(`IP Address:${IP.replaceAll('.', '\\.')}`));
  });
});

describe('the host certbot path is wired to SSL_DIR and the webroot (#3262)', () => {
  it('passes config/work/log dirs to the host certbot', () => {
    expect(SRC).toMatch(/--config-dir "\$\{SSL_DIR\}"/);
    expect(SRC).toMatch(/--work-dir "\$\{SSL_DIR\}\/work"/);
    expect(SRC).toMatch(/--logs-dir "\$\{SSL_DIR\}\/logs"/);
    expect(SRC).toMatch(/--webroot -w "\$\{ACME_WEBROOT\}"/);
  });

  it('fails clearly when the host has no certbot', () => {
    expect(SRC).toMatch(/certbot is not installed/);
  });
});
