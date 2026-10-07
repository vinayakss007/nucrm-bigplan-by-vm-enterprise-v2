import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*!
 * #2302 — a public repo must not carry the live host.
 *
 * AGENTS.md was scrubbed of the running app URL, the shared login and the
 * deploy VM's SSH identity (4b520126), but the same values were still shipped
 * from the files that actually *use* them: the root compose set
 * `NEXT_PUBLIC_APP_URL` to the production address, the pre-prod overlay
 * defaulted it to the pre-prod address (and `next build` inlines `NEXT_PUBLIC_*`
 * into every client bundle), and the deploy workflow `cd`'d into a literal
 * `/home/<deploy-user>/...` while reading that same user from
 * `secrets.DEPLOY_USER`.
 *
 * Two things shape this test:
 *
 * 1. It is a source scan, not a runtime test. Nothing at runtime would notice —
 *    the value is a build argument. CI Secret Scan keys on provider
 *    credentials, not on addresses.
 * 2. It asserts *shapes*, never the leaked values themselves. Naming the old
 *    address here would re-ship it in a new file, which is the bug being fixed.
 *    Rotating what was already published is an owner action; this only stops
 *    the tip of the repo from carrying a host.
 */

const IPV4 = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;

/** Addresses that are not a host on the internet: loopback, RFC1918, link-local,
 *  broadcast/multicast and the RFC5737 documentation ranges the runbooks cite. */
const isPublicIP = (ip: string): boolean => {
  const [a, b, c] = ip.split('.').map(Number);
  if ([a, b, c].some((n) => !Number.isFinite(n))) return false;
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return false;
  if (a === 127 || a === 10) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false; // link-local, incl. the cloud metadata IP
  if (a >= 224) return false; // multicast and reserved
  // TEST-NET-1/2/3, matched on all three leading octets so a real address that
  // merely starts with 203.0 is not excused.
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
};

const publicIPsIn = (text: string): string[] =>
  [...text.matchAll(IPV4)].map((m) => m[1] as string).filter(isPublicIP);

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', 'dist', '.qoder']);
// `.env*` is blanket-gitignored, but `deploy/.env.production` is committed on
// purpose as the copy-from template, so `production` is a real extension here:
// a live host written into it would ship with the clone like any other file.
const TEXT_EXT = /\.(yml|yaml|conf|sh|tf|tfvars|example|md|txt|json|ts|tsx|cjs|mjs|mts|production)$/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(name) || name === 'Dockerfile') out.push(p);
  }
  return out;
};

/** Where a host literal has an *effect*: build args, container env, deploy
 *  scripts, ingress, CI. Docs are excluded on purpose — the infra runbooks
 *  describe the pre-prod address in prose and that is a separate decision. */
const CONFIG_SURFACES = ['docker-compose.yml', 'Dockerfile', 'deploy', '.github'];

const configFiles = (): string[] =>
  CONFIG_SURFACES.flatMap((entry) => (statSync(entry).isDirectory() ? walk(entry) : [entry]));

const readConfig = (): { file: string; text: string }[] =>
  configFiles().map((file) => ({ file, text: readFileSync(file, 'utf8') }));

describe('#2302 deploy config carries no live host address', () => {
  it('scans a non-trivial set of config files', () => {
    // Without this the assertions below could pass because the walk found nothing.
    const scanned = configFiles();
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned).toContain('docker-compose.yml');
    expect(scanned).toContain('deploy/docker-compose.preprod.yml');
    expect(scanned).toContain('deploy/.env.production');
  });

  it('recognises the address shape it is looking for (control)', () => {
    // Deliberately not the project's own address: the guard must not become a
    // new home for the value it is meant to expel.
    expect(publicIPsIn('NEXT_PUBLIC_APP_URL=http://8.8.8.8')).toEqual(['8.8.8.8']);
    expect(publicIPsIn('- subnet: 172.28.0.0/16')).toEqual([]);
    expect(publicIPsIn('admin_cidrs = ["203.0.113.10/32"]')).toEqual([]);
    expect(publicIPsIn('metadata_address = "169.254.169.254"')).toEqual([]);
  });

  it('has no public IPv4 anywhere in the compose files, Dockerfile or workflows', () => {
    const hits = readConfig()
      .map(({ file, text }) => ({ file, ips: publicIPsIn(text) }))
      .filter((hit) => hit.ips.length > 0);
    expect(hits).toEqual([]);
  });

  it('takes the app URL from the operator instead of defaulting it to a host', () => {
    for (const file of ['docker-compose.yml', 'deploy/docker-compose.preprod.yml']) {
      const values = readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => /^\s*(?:-\s+)?NEXT_PUBLIC_APP_URL\s*[=:]\s*(.+)$/.exec(l)?.[1])
        .filter((v): v is string => v !== undefined);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        // Required, never defaulted: a fallback that names a machine is exactly
        // what shipped, and getAppUrl() is meant to fail loudly instead.
        expect(value).toMatch(/\$\{NEXT_PUBLIC_APP_URL:\?/);
        expect(value).not.toMatch(/:-/);
      }
    }
  });

  it('never bakes a deploy user home path into the rollout', () => {
    // The SSH identity comes from secrets.DEPLOY_USER, so an absolute home path
    // is both a leaked username and a path that breaks when that user changes.
    const HOME_PATH = /\/home\/[a-z0-9_.-]+\//i;
    const hits = readConfig()
      .filter(({ text }) => HOME_PATH.test(text))
      .map(({ file }) => file);
    expect(hits).toEqual([]);
  });
});
