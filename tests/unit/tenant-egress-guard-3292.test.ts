/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3292 ask 4 — the screen that keeps tenant-controlled egress out of a bare
 * `fetch`.
 *
 * The vulnerability was not "someone forgot safeFetch": `handleMailgun` built its
 * request target from `instance.config['base_url']`, which the integrations and
 * plugin-engine POST handlers write straight out of the request body, and the
 * response body went back to any authenticated member. Nothing in CI could tell
 * that apart from the sibling handlers that interpolate a literal host.
 *
 * So the gate keys on the ONE part of a URL an SSRF can use — the authority — and
 * on whether the source proves it: `https://api.telegram.org/bot${token}/x` is
 * clean because the hole sits after the first `/`, while `${base}/x` is only clean
 * when `base` is declared as a literal in the same file, for EVERY declaration of
 * that name. These tests pin both halves: the classifier's decisions on fixtures,
 * the shape from the issue report reproduced verbatim, and the real tree at zero
 * offenders.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ALLOWED_FILES,
  analyzeAuthority,
  firstArgument,
  resolveName,
  scanEgress,
  scanFile,
} from '../../scripts/check-tenant-egress.mjs';

const GUARD = join(process.cwd(), 'scripts', 'check-tenant-egress.mjs');

/**
 * The two steps from the issue report, reduced to the shape the gate has to see:
 * a base read from the tenant's config bag, interpolated into a bare fetch.
 */
const VULNERABLE = [
  "export async function handleMailgun(instance, action, params) {",
  "  const apiKey = instance.config['api_key'];",
  "  const baseUrl = instance.config['base_url'] || 'https://api.mailgun.net/v3';",
  "  const res = await fetch(`${baseUrl}/${instance.config['domain']}/messages`, {",
  "    method: 'POST',",
  "  });",
  "  return { success: res.ok, data: await res.json() };",
  "}",
  "",
].join('\n');

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'egress-3292-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

const EMPTY_DIR = fixtureDir({ 'placeholder.ts': 'export const x = 1;\n' });

function scan(src: string, rel = 'lib/sample.ts') {
  return scanFile(join(EMPTY_DIR, rel), src);
}

describe('authority analysis keys on the request authority, not on the whole URL', () => {
  it('treats a hole after the first slash as harmless', () => {
    const { staticText, inAuthority } = analyzeAuthority('`https://api.telegram.org/bot${token}/sendMessage`');
    expect(staticText).toContain('https://api.telegram.org');
    expect(inAuthority).toEqual([]);
  });

  it('treats a hole at position zero as the authority', () => {
    expect(analyzeAuthority('`${baseUrl}/${domain}/messages`').inAuthority).toEqual(['baseUrl']);
  });

  it('treats a hole in the scheme+host position as the authority too', () => {
    expect(analyzeAuthority('`https://${host}/v3/messages`').inAuthority).toEqual(['host']);
  });

  it('reads a relative target as same-origin', () => {
    const { staticText, inAuthority } = analyzeAuthority("'/api/internal/cron'");
    expect(staticText.startsWith('/')).toBe(true);
    expect(inAuthority).toEqual([]);
  });

  it('does not cut the argument at a comma inside a quoted URL', () => {
    const src = "fetch('/api/x?a=1,b', { method: 'POST' })";
    const arg = firstArgument(src, src.indexOf('fetch(') + 'fetch('.length - 1);
    expect(arg).toBe("'/api/x?a=1,b'");
  });
});

describe('name resolution is only satisfied by a proven literal', () => {
  const decls = new Map<string, string[]>([
    ['literalBase', ["'https://api.sendgrid.com/v3'"]],
    ['envBase', ["process.env['LOKI_URL']"]],
    ['selfBase', ['new URL(request.url)']],
    ['redeclared', ["'https://api.openai.com/v1'", "instance.config['base_url']"]],
  ]);

  it('accepts a written-out https base', () => {
    expect(resolveName('literalBase', decls).kind).toBe('literal');
  });

  it('refuses an env-derived base: operator config is a different trust domain', () => {
    expect(resolveName('envBase', decls).kind).toBe('env');
  });

  it('accepts a base built from the incoming request', () => {
    expect(resolveName('selfBase', decls).kind).toBe('self');
  });

  it('refuses a name when ANY declaration in the file is data-derived', () => {
    // `lib/integrations/registry.ts` declares `baseUrl` once per handler, and one
    // of those reads the tenant bag. Proving only the literal ones is exactly how
    // #3292 would survive a gate that stopped at the first declaration.
    expect(resolveName('redeclared', decls).kind).toBe('data');
  });

  it('refuses a name it cannot see declared at all', () => {
    expect(resolveName('mystery', decls).kind).toBe('unknown');
  });
});

describe('scanFile finds the #3292 shape and stays quiet about the honest ones', () => {
  it('flags a tenant-config-derived authority', () => {
    const offenders = scan(VULNERABLE);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].line).toBe(4);
    expect(offenders[0].authorities.join(' ')).toContain('baseUrl:data');
  });

  it('is silent when the same request is issued with safeFetch', () => {
    expect(scan(VULNERABLE.replace('await fetch(', 'await safeFetch('))).toEqual([]);
  });

  it('is silent when the file validates that authority with assertSafeUrl first', () => {
    const guarded = VULNERABLE.replace(
      'const res = await fetch(',
      'assertSafeUrl(baseUrl);\n  const res = await fetch(',
    );
    expect(scan(guarded)).toEqual([]);
  });

  it('is silent for a literal authority with a credential interpolated after it', () => {
    const src = [
      "const token = instance.config['bot_token'];",
      "const res = await fetch(`https://slack.com/api/chat.postMessage`, {",
      "  headers: { Authorization: `Bearer ${token}` },",
      '});',
      '',
    ].join('\n');
    expect(scan(src)).toEqual([]);
  });

  it('skips client components — the browser is the trust boundary there', () => {
    const src = "'use client';\nexport default function Page({ url }) { return <button onClick={() => fetch(url)} />; }\n";
    expect(scan(src)).toEqual([]);
  });

  it('skips the guard module itself', () => {
    const src = 'export async function safeFetch(rawUrl){ return fetch(rawUrl); }\n';
    expect(scan(src, 'lib/security/ssrf.ts')).toEqual([]);
  });
});

describe('the repository is clean under the gate', () => {
  it('has no tenant-facing fetch with an unproven authority', () => {
    const report = scanEgress();
    expect(report.scanned).toBeGreaterThan(1000);
    expect(report.offenders.map((o) => `${o.file}:${o.line} fetch(${o.target}`)).toEqual([]);
  });

  it('scans the integration handler file, so the class cannot come back there', () => {
    // Not a vacuous pass: the fixture above proves the same scan reports this
    // file's shape as an offender while the tenant bag is still in it.
    const src = readFileSync(join(process.cwd(), 'lib', 'integrations', 'registry.ts'), 'utf8');
    expect(src).toContain('handleMailgun');
    expect(scan(src, 'lib/integrations/registry.ts')).toEqual([]);
  });

  it('exemptions name files that still exist — a stale allowlist is a failure', () => {
    const stale = Object.keys(ALLOWED_FILES).filter((rel) => !existsSync(join(process.cwd(), rel)));
    expect(stale).toEqual([]);
  });

  it('every exemption carries a written reason, not a TODO', () => {
    const thin = Object.entries(ALLOWED_FILES)
      .filter(([, why]) => why.length < 20 || /^TODO/.test(why))
      .map(([rel]) => rel);
    expect(thin).toEqual([]);
  });
});

describe('CLI contract', () => {
  function run(args: string[]) {
    return spawnSync('node', [GUARD, ...args], { encoding: 'utf8', cwd: process.cwd() });
  }

  it('exits 1 and prints the remediation when a tenant-derived authority is present', () => {
    const dir = fixtureDir({ 'lib/bad.ts': VULNERABLE });
    const res = run([`--roots=${dir}/lib`]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('lib/bad.ts:4');
    expect(res.stdout).toContain('safeFetch() from lib/security/ssrf.ts');
  });

  it('exits 0 for a clean tree', () => {
    const dir = fixtureDir({
      'lib/ok.ts': "const base = 'https://api.sendgrid.com/v3';\nawait fetch(`${base}/mail/send`);\n",
    });
    const res = run([`--roots=${dir}/lib`]);
    expect(res.stderr).toBe('');
    expect(res.stdout).toContain('0 fetch target(s) with an unproven authority');
    expect(res.status).toBe(0);
  });

  it('answers --json with the offender objects', () => {
    const dir = fixtureDir({ 'lib/bad.ts': VULNERABLE });
    const res = run([`--roots=${dir}/lib`, '--json']);
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.offenders).toHaveLength(1);
  });
});
