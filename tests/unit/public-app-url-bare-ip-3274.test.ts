/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';

// #3274 — `NEXT_PUBLIC_APP_URL` decides canonical links, OAuth redirects, blob
// URLs and the socket.io origin, and `next build` inlines it into every bundle.
// Two failures were invisible to preflight:
//   1. an https origin on a BARE IP — the app is reachable, but no publicly
//      trusted certificate can be issued for it, so every visitor sees a warning;
//   2. an origin that drifted away from ALLOWED_ORIGINS — the app generates
//      links its own cross-origin allowlist rejects.
// Both look configured; neither is. These tests drive the same pure table the
// CLI uses, so the rules cannot be deleted without the suite going red.

type Row = { name: string; value: string; expected: string; status: 'ok' | 'warn' | 'fail'; note: string };
type AssertModule = {
  checkRuntimeFlags: (
    env: Record<string, string | undefined>,
    opts?: { expectProduction?: boolean; trustProxyOptional?: boolean },
  ) => Row[];
};

const GOOD: Record<string, string> = {
  NODE_ENV: 'production',
  TRUST_PROXY: 'true',
  COOKIE_SECURE: 'true',
  DATABASE_SSL: 'true',
  SETUP_KEY: 'a-generated-placeholder-value-not-a-real-key',
  JWT_SECRET: 'a-generated-placeholder-value-not-a-real-key',
  SESSION_SECRET: 'a-generated-placeholder-value-not-a-real-key',
  CRON_SECRET: 'a-generated-placeholder-value-not-a-real-key',
  ENCRYPTION_KEY: 'a-generated-placeholder-value-not-a-real-key',
  NEXT_PUBLIC_APP_URL: 'https://crm.example.com',
  ALLOWED_ORIGINS: 'https://crm.example.com',
};

async function rows(overrides: Record<string, string | undefined>): Promise<Row[]> {
  const { checkRuntimeFlags } = (await import('../../scripts/assert-runtime-env.mjs')) as AssertModule;
  return checkRuntimeFlags({ ...GOOD, ...overrides });
}

const appUrl = (rowsIn: Row[]) => rowsIn.find((r) => r.name === 'NEXT_PUBLIC_APP_URL');

describe('a bare IP cannot be the public origin (#3274)', () => {
  it('fails an https origin whose host is an IPv4 literal', async () => {
    const r = appUrl(await rows({ NEXT_PUBLIC_APP_URL: 'https://203.0.113.7', ALLOWED_ORIGINS: 'https://203.0.113.7' }));
    expect(r?.status).toBe('fail');
    expect(r?.expected).toMatch(/publicly trusted certificate/);
    expect(r?.note).toMatch(/#3274/);
    expect(r?.note).toMatch(/rebuild/);
  });

  it('fails an IPv6 literal in brackets too', async () => {
    const r = appUrl(await rows({ NEXT_PUBLIC_APP_URL: 'https://[2001:db8::1]', ALLOWED_ORIGINS: 'https://[2001:db8::1]' }));
    expect(r?.status).toBe('fail');
  });

  it('reports the host category without echoing the address into a preflight paste', async () => {
    const r = appUrl(await rows({ NEXT_PUBLIC_APP_URL: 'https://203.0.113.7', ALLOWED_ORIGINS: 'https://203.0.113.7' }));
    expect(r?.value).toBe('https, bare-IP host');
    expect(JSON.stringify(r)).not.toContain('203.0.113.7');
  });

  it('does not mistake a hostname that merely starts with an address for an IP', async () => {
    const r = appUrl(await rows({ NEXT_PUBLIC_APP_URL: 'https://203.0.113.7.example.com', ALLOWED_ORIGINS: 'https://203.0.113.7.example.com' }));
    expect(r?.status).toBe('ok');
  });
});

describe('the canonical origin must be admitted by its own allowlist (#3274)', () => {
  it('fails when NEXT_PUBLIC_APP_URL is absent from ALLOWED_ORIGINS', async () => {
    const r = appUrl(await rows({ NEXT_PUBLIC_APP_URL: 'https://crm.example.com', ALLOWED_ORIGINS: 'https://old.example.com' }));
    expect(r?.status).toBe('fail');
    expect(r?.expected).toBe('one of ALLOWED_ORIGINS');
    expect(r?.note).toMatch(/rebuild/);
  });

  it('accepts a list that contains the canonical origin alongside others', async () => {
    const r = appUrl(await rows({ ALLOWED_ORIGINS: 'https://old.example.com, https://crm.example.com' }));
    expect(r?.status).toBe('ok');
  });

  it('compares origins, not spelling: a trailing slash is not drift', async () => {
    const r = appUrl(await rows({ NEXT_PUBLIC_APP_URL: 'https://crm.example.com/', ALLOWED_ORIGINS: 'https://crm.example.com' }));
    expect(r?.status).toBe('ok');
  });

  it('leaves the check alone when ALLOWED_ORIGINS is unset (a separate rule owns that)', async () => {
    const r = appUrl(await rows({ ALLOWED_ORIGINS: '' }));
    expect(r?.status).toBe('ok');
  });
});

describe('the bare-IP rule is a production rule (#3274)', () => {
  it('does not fail a development box served on an IP', async () => {
    const r = appUrl(await rows({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://203.0.113.7', ALLOWED_ORIGINS: 'http://203.0.113.7' }));
    expect(r?.status).not.toBe('fail');
  });
});
