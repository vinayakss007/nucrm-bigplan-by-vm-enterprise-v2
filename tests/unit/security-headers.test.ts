/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Security-header regression guard (#1839).
 *
 * These headers were audited as present and must not silently disappear. We
 * assert against the SOURCE of next.config.mjs rather than importing it,
 * because importing the config executes a top-level `execSync('curl ifconfig.me')`
 * external-IP probe that is slow/flaky and inappropriate for a unit test.
 *
 * The CSP is intentionally NOT set here — it is emitted per-request with a
 * nonce from proxy.ts (#1070); that is covered elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');

describe('security headers (next.config.mjs) — #1839', () => {
  it('sets X-Frame-Options: SAMEORIGIN', () => {
    expect(config).toMatch(/X-Frame-Options['"]?\s*,\s*value:\s*['"]SAMEORIGIN['"]/);
  });

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(config).toMatch(/X-Content-Type-Options['"]?\s*,\s*value:\s*['"]nosniff['"]/);
  });

  it('sets a Referrer-Policy', () => {
    expect(config).toMatch(/Referrer-Policy['"]?\s*,\s*value:\s*['"]strict-origin-when-cross-origin['"]/);
  });

  it('enforces HSTS in production with a strong max-age + includeSubDomains', () => {
    // Must be gated on production and carry a >= 1 year max-age with includeSubDomains.
    expect(config).toMatch(/Strict-Transport-Security/);
    const hsts = config.match(/Strict-Transport-Security['"]?\s*,\s*value:\s*['"]([^'"]+)['"]/);
    expect(hsts).toBeTruthy();
    const value = hsts![1]!;
    const maxAge = Number(value.match(/max-age=(\d+)/)?.[1] ?? '0');
    expect(maxAge).toBeGreaterThanOrEqual(31536000); // >= 1 year
    expect(value).toContain('includeSubDomains');
    // Only applied in production.
    expect(config).toMatch(/NODE_ENV === 'production'[\s\S]*Strict-Transport-Security/);
  });

  it('locks down Permissions-Policy (camera/microphone/geolocation at minimum)', () => {
    const pp = config.match(/Permissions-Policy['"]?\s*,\s*value:\s*['"]([^'"]+)['"]/);
    expect(pp).toBeTruthy();
    const value = pp![1]!;
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
      expect(value).toContain(feature);
    }
  });

  it('sets Cross-Origin-Opener-Policy: same-origin', () => {
    expect(config).toMatch(/Cross-Origin-Opener-Policy['"]?\s*,\s*value:\s*['"]same-origin['"]/);
  });

  it('does NOT set a static Content-Security-Policy (CSP is per-request in proxy.ts)', () => {
    // A static CSP here would override the per-request nonce policy (#1070).
    expect(config).not.toMatch(/key:\s*['"]Content-Security-Policy['"]/);
  });
});
