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

/**
 * A dotted quad that is not glued to more digits, dots or word characters.
 *
 * `\b` is not enough: `#section-3.4.2.2` in an RFC link (lib/scim/index.ts) and
 * `1.384.766.296` inside an SVG path (components/marketing/social-icons.tsx) both
 * satisfy it. A guard that fails a build over a decimal is a guard people route
 * around, so the shape check is strict and the octet range is checked too.
 */
const IPV4 = /(?<![A-Za-z0-9.\-_])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![A-Za-z0-9.\-_])/g;

/** Addresses that are not a host on the internet: loopback, RFC1918, link-local,
 *  broadcast/multicast, the RFC5737 documentation ranges the runbooks cite, and
 *  the special-purpose ranges this repo names as *examples*, not as targets. */
const isPublicIP = (ip: string): boolean => {
  const octets = ip.split('.').map(Number);
  if (octets.some((n) => !Number.isFinite(n))) return false;
  if (octets.some((n) => n > 255)) return false; // not an address at all
  const [a, b, c] = octets;
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return false;
  if (a === 127 || a === 10) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false; // link-local, incl. the cloud metadata IP
  if (a === 100 && b >= 64 && b <= 127) return false; // RFC6598 shared address space
  if (a >= 224) return false; // multicast and reserved
  // TEST-NET-1/2/3, matched on all three leading octets so a real address that
  // merely starts with 203.0 is not excused.
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  // IANA special-purpose ranges the repo names on purpose, in code that blocks
  // them (lib/security/ssrf.ts) rather than in order to contact them.
  if (a === 192 && b === 0 && c === 0) return false; // RFC6890 protocol assignments
  if (a === 198 && b >= 18 && b <= 19) return false; // RFC2544 benchmarking
  // Google publishes these as the source ranges its own schedulers and load
  // balancers come from (.env.example, docs/SECURITY-AUDIT-2026-08-07.md);
  // naming them identifies Google, not this deployment.
  if (a === 35 && b === 191) return false;
  if (a === 130 && b === 211 && c === 0) return false;
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
 *  scripts, ingress, CI. */
const CONFIG_SURFACES = ['docker-compose.yml', 'Dockerfile', 'deploy', '.github'];

/**
 * The rest of the tree, which the original guard waved off: "the infra runbooks
 * describe the pre-prod address in prose and that is a separate decision".
 *
 * The decision is made, and the answer was that it was never separate. Twelve
 * occurrences of this deployment's own addresses were shipping from five files —
 * eight in the issue register, one in the fixes-and-lessons log, one in
 * `scripts/fire-cron.mts` (a *comment*, but that address is the certificate CN
 * the script pins), one in `docs/planning/TEST_PLAN.txt` sitting on the line
 * above a plaintext admin password, and one third-party customer's IP with their
 * ISP named next to it. A public repo cannot hand out the map to a running
 * system and file the exception under "prose".
 *
 * `tests/` and `.agents/` stay out: fixtures need addresses that behave like
 * foreign ones (`1.2.3.4` as an attacker, `8.8.8.8` as a resolver), and
 * policing them would push test inputs toward shapes that prove nothing.
 *
 * A text scan is also blind to the one file that still carries the host in a
 * non-textual form: `deploy/certs/preprod-ca.pem` has the pre-prod address as
 * its subject CN, base64-wrapped. Deleting it breaks the TLS trust that
 * `scripts/fire-cron.mts` and the backup verifiers pin, so re-issuing that
 * certificate against a DNS name is an owner action, not a guard's.
 */
const UNPOLICED_PREFIXES = ['tests/', '.agents/'];

const sourceFiles = (): string[] =>
  walk('.').filter((f) => !UNPOLICED_PREFIXES.some((p) => f.startsWith(p)));

/** Report a finding without re-publishing it: Actions logs on a public repo are
 *  public, so the leak would survive the guard that caught it. */
const maskIP = (ip: string): string => {
  const [a, b] = ip.split('.');
  return `${a}.${b}.*.*`;
};

const leakyFiles = (files: string[]): string[] =>
  files
    .flatMap((file) => {
      const ips = publicIPsIn(readFileSync(file, 'utf8'));
      return ips.length > 0 ? [`${file}: ${ips.map(maskIP).join(', ')}`] : [];
    })
    .sort();

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
    // Shapes that live in this repo and are *not* addresses. Each is a real line
    // from a real file, so regressing one is a false positive the next reader
    // would have to debug at the worst possible moment.
    expect(publicIPsIn('html/rfc7644#section-3.4.2.2')).toEqual([]);
    expect(publicIPsIn('67.666 1.336 1.079 2.126 1.384.766.296 1.636.499')).toEqual([]);
    expect(publicIPsIn("{ cidr: '192.0.0.0', prefix: 24 }")).toEqual([]);
    expect(publicIPsIn("{ cidr: '198.18.0.0', prefix: 15 }")).toEqual([]);
    expect(publicIPsIn('CRON_ALLOWED_IPS=35.191.0.0/16,130.211.0.0/22')).toEqual([]);
    // …and a genuinely routable host still reads as one in every shape the
    // runbooks use. These are public resolvers, never this deployment.
    expect(publicIPsIn('VM `1.1.1.1`')).toEqual(['1.1.1.1']);
    expect(publicIPsIn('CN=1.1.1.1, issued by itself')).toEqual(['1.1.1.1']);
    expect(publicIPsIn('https://1.1.1.1/api/health')).toEqual(['1.1.1.1']);
    expect(publicIPsIn('inet_server_addr() → 1.1.1.1|11569')).toEqual(['1.1.1.1']);
  });

  it('has no public IPv4 anywhere in the compose files, Dockerfile or workflows', () => {
    expect(leakyFiles(configFiles())).toEqual([]);
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

describe('#2302 follow-up: prose and source carry no live host either', () => {
  it('scans the files the original guard waved off', () => {
    // Fail loudly if the walk silently shrinks — an assertion that passes
    // because it looked at nothing is worse than the leak it hides.
    const scanned = sourceFiles();
    expect(scanned.length).toBeGreaterThan(500);
    expect(scanned).toContain('docs/infra/PREPROD-ISSUE-REGISTER.md');
    expect(scanned).toContain('docs/infra/PREPROD-FIXES-LESSONS.md');
    expect(scanned).toContain('docs/planning/TEST_PLAN.txt');
    expect(scanned).toContain('scripts/fire-cron.mts');
    expect(scanned.some((f) => f.startsWith('app/'))).toBe(true);
    expect(scanned.some((f) => UNPOLICED_PREFIXES.some((p) => f.startsWith(p)))).toBe(false);
  });

  it('has no publicly-routable IPv4 in docs, scripts, app source or workflows', () => {
    expect(leakyFiles(sourceFiles())).toEqual([]);
  });

  it('leaves the redacted placeholders findable', () => {
    // A named placeholder is only better than a raw address if the next reader
    // can tell which machine it meant without digging the value back out of
    // public git history.
    const register = readFileSync('docs/infra/PREPROD-ISSUE-REGISTER.md', 'utf8');
    expect(register).toContain('<PREPROD_HOST>');
    expect(register).toContain('<PGBOUNCER_IP>');
    expect(readFileSync('scripts/fire-cron.mts', 'utf8')).toContain('<PREPROD_HOST>');
    // The credential published beside the test URL is gone from the tip; the
    // account itself still has to be rotated, which no repo edit can do.
    expect(readFileSync('docs/planning/TEST_PLAN.txt', 'utf8')).toContain('<REDACTED-ADMIN-CREDENTIAL');
  });
});
