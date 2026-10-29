/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3271 — the flags whose misconfiguration is silent, and the deploy wiring
 * that supplies them.
 *
 * `getClientIp()` answers `'unknown'` unless `TRUST_PROXY === 'true'`, and
 * `checkRateLimit` then fails closed on every auth endpoint with 503. Nothing
 * in the code was wrong; the value simply never reached the server process,
 * because pm2 replays the environment it captured at first `start` and
 * `.env.local` is read by Next.js only for names that are not already set. So
 * these tests pin the two things that actually broke: what the audit says about
 * a given environment, and what the repo's own deploy config hands the process.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditRuntimeFlags } from '@/lib/env';
import { assertRuntimeEnv, nextAppEnv } from '@/scripts/assert-runtime-env';

const PRODUCTION = { NODE_ENV: 'production' };

function rowOf(rows: ReturnType<typeof auditRuntimeFlags>, name: string) {
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`no audit row for ${name}`);
  return row;
}

describe('auditRuntimeFlags: TRUST_PROXY (#3271)', () => {
  it('fails a production environment that never got the flag', () => {
    const rows = auditRuntimeFlags(PRODUCTION);
    expect(rowOf(rows, 'TRUST_PROXY').status).toBe('fail');
    expect(rowOf(rows, 'TRUST_PROXY').note).toContain('503');
  });

  it('treats an unset flag and a wrong-spelling flag as the same outage', () => {
    for (const value of [undefined, 'false', 'TRUE', '1', '']) {
      const env: Record<string, string | undefined> = { ...PRODUCTION };
      if (value !== undefined) env.TRUST_PROXY = value;
      expect(auditRuntimeFlags(env).find((r) => r.name === 'TRUST_PROXY')?.status, `TRUST_PROXY=${String(value)}`).toBe('fail');
    }
  });

  it('passes when the flag is exactly true', () => {
    expect(rowOf(auditRuntimeFlags({ ...PRODUCTION, TRUST_PROXY: 'true' }), 'TRUST_PROXY').status).toBe('ok');
  });

  it('says nothing is wrong outside production, where the flag is a dev choice', () => {
    expect(rowOf(auditRuntimeFlags({ NODE_ENV: 'development' }), 'TRUST_PROXY').status).toBe('ok');
  });

  it('downgrades to a warning only when told the platform terminates the proxy', () => {
    const rows = auditRuntimeFlags(PRODUCTION, { trustProxyMayBeUnset: true });
    expect(rowOf(rows, 'TRUST_PROXY').status).toBe('warn');
  });
});

describe('auditRuntimeFlags: the two cron flags that depend on it', () => {
  it('fails an IP allowlist the server cannot read an address for', () => {
    const rows = auditRuntimeFlags({ ...PRODUCTION, TRUST_PROXY: 'true', CRON_ALLOWED_IPS: '35.191.0.0/16' });
    expect(rowOf(rows, 'CRON_ALLOWED_IPS').status).toBe('ok');
    expect(rowOf(auditRuntimeFlags({ ...PRODUCTION, CRON_ALLOWED_IPS: '35.191.0.0/16' }), 'CRON_ALLOWED_IPS').status).toBe('fail');
  });

  it('does not treat a blank allowlist as a denial of every cron call', () => {
    expect(rowOf(auditRuntimeFlags({ ...PRODUCTION, CRON_ALLOWED_IPS: '   ' }), 'CRON_ALLOWED_IPS').status).toBe('ok');
  });

  it('warns that CRON_SIGNING_KEY is an off switch, and never prints its value', () => {
    const rows = auditRuntimeFlags({ ...PRODUCTION, TRUST_PROXY: 'true', CRON_SIGNING_KEY: 'a-key-nobody-must-see' });
    const signing = rowOf(rows, 'CRON_SIGNING_KEY');
    expect(signing.status).toBe('warn');
    expect(signing.value).toBe('(set)');
    expect(JSON.stringify(signing)).not.toContain('a-key-nobody-must-see');
  });
});

describe('nextAppEnv: which pm2 app is the server', () => {
  it('picks the app that runs Next and stringifies its env block', () => {
    const target = nextAppEnv({
      apps: [
        { name: 'worker', script: 'node_modules/.bin/tsx', env: { NODE_ENV: 'production' } },
        { name: 'web', script: 'node_modules/.bin/next', env: { NODE_ENV: 'production', PORT: 3000, TRUST_PROXY: 'true' } },
      ],
    });
    expect(target.label).toContain('"web"');
    expect(target.env.PORT).toBe('3000');
    expect(target.env.TRUST_PROXY).toBe('true');
  });

  it('names the gap when no app runs Next rather than auditing nothing silently', () => {
    const target = nextAppEnv({ apps: [{ name: 'worker', script: 'tsx', env: {} }] });
    expect(target.env).toEqual({});
    expect(target.label).toContain('no Next app');
  });
});

describe('assertRuntimeEnv against this repo\'s own deploy wiring (#3271)', () => {
  /**
   * Hermetic on purpose: `shellEnv` is the whole starting environment, so the
   * test runner's own TRUST_PROXY / CRON_* values cannot leak in, and the only
   * way the first case passes is if `ecosystem.config.cjs` supplies the flag
   * itself.
   *
   * #3279 folded the two same-named CLIs into one — `scripts/assert-runtime-env
   * .mjs`, the file the issue names, whose `resolveEffectiveEnv` already carried
   * the ecosystem overlay, `--process-only` and `--trust-proxy-optional`. The
   * deps-object call shape below is that script's; the three claims are the ones
   * #3271 landed these tests for, unchanged.
   */
  const row = (result: ReturnType<typeof assertRuntimeEnv>, name: string) => {
    const found = result.rows.find((r) => r.name === name);
    if (!found) throw new Error(`no row for ${name}`);
    return found;
  };

  it('holds no failure once ecosystem.config.cjs supplies the web app env', () => {
    const result = assertRuntimeEnv({ argv: [], shellEnv: PRODUCTION, envFileCandidates: [] });
    expect(result.source).toContain('ecosystem.config.cjs');
    expect(result.failures).toBe(0);
    expect(row(result, 'TRUST_PROXY').value).toBe('true');
  });

  it('fails the same environment when read from the shell alone (--process-only)', () => {
    const result = assertRuntimeEnv({ argv: ['--process-only'], shellEnv: PRODUCTION });
    expect(result.source).toContain('process.env');
    expect(result.failures).toBe(1);
    expect(row(result, 'TRUST_PROXY').status).toBe('fail');
  });

  it('lets a proxy-terminating platform opt that one failure down', () => {
    const result = assertRuntimeEnv({
      argv: ['--process-only', '--trust-proxy-optional'],
      shellEnv: PRODUCTION,
    });
    expect(result.failures).toBe(0);
    expect(row(result, 'TRUST_PROXY').status).toBe('warn');
  });
});

describe('the requirement is written where an operator reads it', () => {
  const example = readFileSync('.env.example', 'utf8');

  it('says the process env is what counts and names the --update-env remedy', () => {
    expect(example).toContain('the *process env*');
    expect(example).toContain('--update-env');
    expect(example).toMatch(/503 "client IP unavailable/);
  });

  it('keeps the tunable override documented in the pm2 config', () => {
    const config = readFileSync('ecosystem.config.cjs', 'utf8');
    expect(config).toContain("TRUST_PROXY: setting('NUCRM_TRUST_PROXY')");
    expect(config).toContain('NUCRM_TRUST_PROXY');
  });
});
