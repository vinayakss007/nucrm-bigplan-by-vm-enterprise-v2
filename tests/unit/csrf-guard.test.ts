/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the in-handler CSRF defense-in-depth guard (#1835).
 *
 * enforceCsrf() is exercised against the REAL csrf module (it is pure), so the
 * double-submit token comparison and the exemption logic are validated end to
 * end. The key security property under test: the api-key CSRF exemption is
 * derived from a REAL `Authorization: Bearer ak_...` token, so a cookie-only
 * request cannot spoof `x-auth-method: api_key` to skip CSRF.
 */
import { describe, it, expect } from 'vitest';
import { enforceCsrf } from '@/lib/auth/csrf-guard';

const TOKEN = 'a'.repeat(64);
const PATH = 'http://localhost:3000/api/tenant/billing/subscription/upgrade';

function req(opts: {
  method?: string;
  path?: string;
  cookie?: string;
  csrfHeader?: string;
  auth?: string;
  extraHeaders?: Record<string, string>;
} = {}): Request {
  const headers = new Headers(opts.extraHeaders ?? {});
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.csrfHeader) headers.set('x-csrf-token', opts.csrfHeader);
  if (opts.auth) headers.set('authorization', opts.auth);
  return new Request(opts.path ?? PATH, { method: opts.method ?? 'POST', headers });
}

describe('enforceCsrf', () => {
  it('passes when cookie and header tokens match', () => {
    const result = enforceCsrf(req({ cookie: `nucrm_csrf_token=${TOKEN}`, csrfHeader: TOKEN }));
    expect(result).toBeNull();
  });

  it('rejects (403) when the CSRF header is missing', () => {
    const result = enforceCsrf(req({ cookie: `nucrm_csrf_token=${TOKEN}` }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('rejects (403) when cookie and header tokens do not match', () => {
    const result = enforceCsrf(req({ cookie: `nucrm_csrf_token=${TOKEN}`, csrfHeader: 'b'.repeat(64) }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('rejects (403) when there is no CSRF cookie at all', () => {
    const result = enforceCsrf(req({ csrfHeader: TOKEN }));
    expect(result!.status).toBe(403);
  });

  it('exempts safe methods (GET)', () => {
    expect(enforceCsrf(req({ method: 'GET' }))).toBeNull();
  });

  it('exempts a real api-key bearer token (ak_) without a CSRF token', () => {
    const result = enforceCsrf(req({ auth: 'Bearer ak_live_123456' }));
    expect(result).toBeNull();
  });

  it('SECURITY: does NOT exempt a spoofed x-auth-method=api_key on a cookie request', () => {
    // Attacker sets the header but has no ak_ bearer → must still require CSRF.
    const result = enforceCsrf(req({
      extraHeaders: { 'x-auth-method': 'api_key' },
      cookie: 'nucrm_session=sess', // cookie-authenticated, no csrf token
    }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('SECURITY: a non-ak_ bearer token is NOT treated as api-key exempt', () => {
    // A JWT bearer must still go through CSRF validation.
    const result = enforceCsrf(req({ auth: 'Bearer eyJhbGciOi.jwt.token' }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('exempts webhook paths', () => {
    expect(enforceCsrf(req({ path: 'http://localhost:3000/api/webhooks/stripe' }))).toBeNull();
  });

  it('exempts the pre-auth login route', () => {
    expect(enforceCsrf(req({ path: 'http://localhost:3000/api/auth/login' }))).toBeNull();
  });
});
