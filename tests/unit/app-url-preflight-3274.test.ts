/**
 * #3274 — `NEXT_PUBLIC_APP_URL` is baked into every bundle at build time. A bare
 * IP can only ever serve a self-signed certificate, and a value that disagrees
 * with `APP_URL` means server-generated links point somewhere else. Both used to
 * pass `npm run prod:preflight`; both are now fail-closed, and the runbook says
 * the trusted hostname is a prerequisite rather than later polish.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkRuntimeFlags,
  hostIsBareIp,
  originOf,
} from '../../scripts/assert-runtime-env.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');

type Row = { name: string; value: string; expected: string; status: 'ok' | 'warn' | 'fail'; note: string };

function appUrlRow(value: string, extra: Record<string, string> = {}): Row {
  const rows = checkRuntimeFlags(
    { NEXT_PUBLIC_APP_URL: value, ...extra },
    { expectProduction: true },
  ) as Row[];
  const row = rows.find((r) => r.name === 'NEXT_PUBLIC_APP_URL');
  expect(row, 'NEXT_PUBLIC_APP_URL is not in the fail-closed table').toBeDefined();
  return row!;
}

describe('bare-IP detection', () => {
  it('recognises IPv4 and IPv6 literals', () => {
    expect(hostIsBareIp('https://203.0.113.10')).toBe(true);
    expect(hostIsBareIp('https://203.0.113.10:8443')).toBe(true);
    expect(hostIsBareIp('https://[2001:db8::1]')).toBe(true);
  });

  it('leaves real hostnames alone', () => {
    expect(hostIsBareIp('https://crm.example.com')).toBe(false);
    expect(hostIsBareIp('https://crm.example.com:8443')).toBe(false);
    expect(hostIsBareIp('not a url')).toBe(false);
  });

  it('normalises an origin without treating a trailing slash as drift', () => {
    expect(originOf('https://crm.example.com/')).toBe('https://crm.example.com');
    expect(originOf('https://crm.example.com:8443/path')).toBe('https://crm.example.com:8443');
  });
});

describe('NEXT_PUBLIC_APP_URL in production', () => {
  it('fails a bare IPv4 origin, because no CA can issue for it', () => {
    const row = appUrlRow('https://203.0.113.10');
    expect(row.status).toBe('fail');
    expect(row.expected).toMatch(/hostname/);
    expect(row.note).toMatch(/bare IP/);
  });

  it('fails a bare IPv6 origin for the same reason', () => {
    expect(appUrlRow('https://[2001:db8::1]').status).toBe('fail');
  });

  it('accepts a real https hostname, with or without a port', () => {
    expect(appUrlRow('https://crm.example.com').status).toBe('ok');
    expect(appUrlRow('https://crm.example.com:8443').status).toBe('ok');
  });

  it('fails when APP_URL names a different origin', () => {
    const row = appUrlRow('https://crm.example.com', { APP_URL: 'https://old.example.com' });
    expect(row.status).toBe('fail');
    expect(row.expected).toBe('the same origin as APP_URL');
    expect(row.note).toMatch(/rebuild/);
  });

  it('fails when only the scheme differs, which still breaks redirects', () => {
    expect(
      appUrlRow('https://crm.example.com', { APP_URL: 'http://crm.example.com' }).status,
    ).toBe('fail');
  });

  it('accepts the same origin written with a trailing slash', () => {
    expect(
      appUrlRow('https://crm.example.com', { APP_URL: 'https://crm.example.com/' }).status,
    ).toBe('ok');
  });

  it('does not fail a development box that is deliberately on a private IP', () => {
    const rows = checkRuntimeFlags({ NEXT_PUBLIC_APP_URL: 'http://192.0.2.10:3000' }) as Row[];
    expect(rows.find((r) => r.name === 'NEXT_PUBLIC_APP_URL')?.status).not.toBe('fail');
  });

  it('never prints the address it rejected', () => {
    const rows = checkRuntimeFlags(
      { NEXT_PUBLIC_APP_URL: 'https://203.0.113.10' },
      { expectProduction: true },
    ) as Row[];
    expect(JSON.stringify(rows)).not.toContain('203.0.113.10');
  });
});

describe('the operator-facing docs say the same thing', () => {
  const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');
  const runbook = readFileSync(join(ROOT, 'deploy', 'LAUNCH_RUNBOOK.md'), 'utf8');
  const preflightSection = runbook.slice(0, runbook.indexOf('## §1.'));

  it('calls out the rebuild requirement next to NEXT_PUBLIC_APP_URL', () => {
    const assignment = envExample.indexOf('\nNEXT_PUBLIC_APP_URL=');
    expect(assignment).toBeGreaterThan(0);
    // The comment block immediately above the assignment is what an operator copies
    // with the value; an earlier mention of the name in the file is not that block.
    const block = envExample.slice(Math.max(0, assignment - 700), assignment);
    expect(block).toMatch(/REBUILD/);
    expect(block).toMatch(/bare IP/);
  });

  it('puts hostname + certificate in §0, before the firewall and TLS sections', () => {
    expect(preflightSection).toMatch(/hostname/i);
    expect(preflightSection).toMatch(/bare IP/);
    expect(preflightSection).toMatch(/#3274/);
  });
});
