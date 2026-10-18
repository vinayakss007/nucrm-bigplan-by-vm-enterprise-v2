/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// #2592 — the self-signed TLS fallback was minted with only `-subj /CN=…` and no
// subjectAltName, so it named *nothing* a browser would accept (RFC 6125 §6.4.4
// forbids the CN fallback Chrome 58 / Firefox 48 removed). The operator's `curl`
// smoke test still passed because curl honours CN for DNS names — only an IP
// identifier exposed the defect, via `openssl verify -verify_ip` returning 64.
// These tests pin the fix: the SAN decision, that a SAN-bearing cert passes an
// IP check the old one could not, and that the script actually wires it up.

const ROOT = join(__dirname, '..', '..');
const HELPER = join(ROOT, 'deploy', 'scripts', 'lib', 'self-signed-san.sh');
const SCRIPT = join(ROOT, 'deploy', 'scripts', 'setup-ssl.sh');

// Echo the SAN the sourceable helper computes for a given identifier.
function sanFor(id: string): string {
  return execFileSync('bash', ['-c', `set -e; . '${HELPER}'; compute_subject_alt_name "$1"`, 'bash', id],
    { encoding: 'utf8' }).trim();
}

const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' });
const haveOpenssl = openssl.status === 0;

function selfSignedCert(identifier: string, san: string): { dir: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nucrm-ssl-'));
  const cert = join(dir, 'fullchain.pem');
  const key = join(dir, 'privkey.pem');
  execFileSync('openssl', [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1',
    '-keyout', key, '-out', cert,
    '-subj', `/CN=${identifier}/O=NuCRM`,
    '-addext', `subjectAltName=${san}`,
  ], { stdio: 'pipe' });
  return { dir, cert };
}

function certHasSan(cert: string): string {
  return execFileSync('openssl', ['x509', '-in', cert, '-noout', '-text'], { encoding: 'utf8' });
}

describe('self-signed subjectAltName helper (#2592)', () => {
  it('names an IP identifier with an IP SAN (never the CN)', () => {
    expect(sanFor('203.0.113.7')).toBe('IP:203.0.113.7');
  });

  it('names a hostname with a DNS SAN', () => {
    expect(sanFor('crm.acme.com')).toBe('DNS:crm.acme.com');
  });

  it('covers both loopback spellings for the empty / localhost default', () => {
    expect(sanFor('localhost')).toBe('DNS:localhost,IP:127.0.0.1');
    expect(sanFor('')).toBe('DNS:localhost,IP:127.0.0.1');
  });
});

(haveOpenssl ? describe : describe.skip)('generated certificate satisfies IP validation (#2592)', () => {
  const IP = '203.0.113.7';

  it('carries the SAN and passes openssl verify -verify_ip', () => {
    const { cert } = selfSignedCert(IP, sanFor(IP));
    expect(certHasSan(cert)).toMatch(/IP Address:203\.0\.113\.7/);
    const verify = spawnSync('openssl', ['verify', '-CAfile', cert, '-verify_ip', IP, cert], { encoding: 'utf8' });
    expect(verify.status).toBe(0);
    expect(`${verify.stdout}${verify.stderr}`).toContain('OK');
  });

  it('a CN-only cert (the pre-#2592 shape) is REJECTED for the same IP — why the fix exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nucrm-ssl-'));
    const cert = join(dir, 'fullchain.pem');
    execFileSync('openssl', [
      'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1',
      '-keyout', join(dir, 'privkey.pem'), '-out', cert,
      '-subj', `/CN=${IP}/O=NuCRM`,
    ], { stdio: 'pipe' });
    expect(certHasSan(cert)).not.toMatch(/Subject Alternative Name/);
    const verify = spawnSync('openssl', ['verify', '-CAfile', cert, '-verify_ip', IP, cert], { encoding: 'utf8' });
    expect(verify.status).not.toBe(0);
  });
});

describe('setup-ssl.sh wires the SAN in (#2592)', () => {
  const src = readFileSync(SCRIPT, 'utf8');

  it('sources the helper before generating', () => {
    expect(src).toMatch(/self-signed-san\.sh/);
    expect(src).toMatch(/compute_subject_alt_name/);
  });

  it('passes -addext subjectAltName to the self-signed openssl req', () => {
    expect(src).toMatch(/-addext[^\n]*subjectAltName=\$\{san\}/);
  });

  it('verifies the SAN survived generation and fails loudly if not', () => {
    expect(src).toMatch(/no subjectAltName/);
    expect(src).toMatch(/exit 3/);
  });

  it('no longer claims certbot renews the self-signed path', () => {
    // the "renew every 12h" line must be gated on the letsencrypt branch only
    const renewIdx = src.indexOf("certbot renew' every 12h");
    const gateIdx = src.indexOf('CERT_KIND" == "letsencrypt');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(renewIdx).toBeGreaterThan(gateIdx);
    expect(src).toMatch(/NOT renewed by certbot/);
  });
});
