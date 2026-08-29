/**
 * Coverage for lib/auth/cron.ts.
 *
 * The file is 14 lines but sat at 75% statements / 33% branches: only the two
 * early `return false` guards were exercised, never L13 — the actual
 * timing-safe comparison. That is the line that decides whether an
 * unauthenticated caller can trigger every cron endpoint, so the branch worth
 * proving is that a *matching* secret is the only thing that returns true.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { verifyCronSecret } from '@/lib/auth/cron';

/** Minimal NextRequest stand-in: verifyCronSecret only reads request headers. */
function req(headers: Record<string, string> = {}) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as never;
}

const ORIGINAL = process.env['CRON_SECRET'];
const ORIGINAL_IPS = process.env['CRON_ALLOWED_IPS'];
const ORIGINAL_SIGNING = process.env['CRON_SIGNING_KEY'];
const ORIGINAL_TRUST = process.env['TRUST_PROXY'];

function restore(key: string, val: string | undefined) {
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
}

beforeEach(() => {
  process.env['CRON_SECRET'] = 'super-secret-cron-value';
  // Opt-in hardening layers off by default so the baseline behaviour is tested.
  delete process.env['CRON_ALLOWED_IPS'];
  delete process.env['CRON_SIGNING_KEY'];
  delete process.env['TRUST_PROXY'];
});

afterEach(() => {
  restore('CRON_SECRET', ORIGINAL);
  restore('CRON_ALLOWED_IPS', ORIGINAL_IPS);
  restore('CRON_SIGNING_KEY', ORIGINAL_SIGNING);
  restore('TRUST_PROXY', ORIGINAL_TRUST);
});

describe('verifyCronSecret', () => {
  it('accepts a header that matches CRON_SECRET exactly', async () => {
    await expect(
      verifyCronSecret(req({ 'x-cron-secret': 'super-secret-cron-value' })),
    ).resolves.toBe(true);
  });

  it('rejects a wrong secret of the same length', async () => {
    // Same length so the comparison cannot short-circuit on size alone.
    await expect(
      verifyCronSecret(req({ 'x-cron-secret': 'super-secret-cron-VALUE' })),
    ).resolves.toBe(false);
  });

  it('rejects a wrong secret of a different length', async () => {
    await expect(verifyCronSecret(req({ 'x-cron-secret': 'nope' }))).resolves.toBe(false);
  });

  it('rejects a request with no x-cron-secret header', async () => {
    await expect(verifyCronSecret(req())).resolves.toBe(false);
  });

  it('rejects an empty header value', async () => {
    await expect(verifyCronSecret(req({ 'x-cron-secret': '' }))).resolves.toBe(false);
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    delete process.env['CRON_SECRET'];
    // An unset secret must not make every caller authorised.
    await expect(
      verifyCronSecret(req({ 'x-cron-secret': 'anything' })),
    ).resolves.toBe(false);
  });

  it('fails closed when CRON_SECRET is empty', async () => {
    process.env['CRON_SECRET'] = '';
    await expect(verifyCronSecret(req({ 'x-cron-secret': '' }))).resolves.toBe(false);
  });

  it('rejects a secret that is only a prefix of the real one', async () => {
    await expect(
      verifyCronSecret(req({ 'x-cron-secret': 'super-secret' })),
    ).resolves.toBe(false);
  });
});

describe('verifyCronSecret — IP allowlist (#1165)', () => {
  it('is not enforced when CRON_ALLOWED_IPS is unset (backwards compatible)', async () => {
    await expect(
      verifyCronSecret(req({ 'x-cron-secret': 'super-secret-cron-value' })),
    ).resolves.toBe(true);
  });

  it('denies a valid secret from an IP outside the allowlist', async () => {
    process.env['CRON_ALLOWED_IPS'] = '10.0.0.0/8, 35.191.0.1';
    process.env['TRUST_PROXY'] = 'true';
    await expect(
      verifyCronSecret(
        req({ 'x-cron-secret': 'super-secret-cron-value', 'x-forwarded-for': '203.0.113.5' }),
      ),
    ).resolves.toBe(false);
  });

  it('allows a valid secret from an IP inside a CIDR range', async () => {
    process.env['CRON_ALLOWED_IPS'] = '10.0.0.0/8';
    process.env['TRUST_PROXY'] = 'true';
    await expect(
      verifyCronSecret(
        req({ 'x-cron-secret': 'super-secret-cron-value', 'x-forwarded-for': '10.4.2.9' }),
      ),
    ).resolves.toBe(true);
  });

  it('fails closed when an allowlist is set but the IP cannot be trusted', async () => {
    // Allowlist configured but TRUST_PROXY is not enabled -> IP is untrusted.
    process.env['CRON_ALLOWED_IPS'] = '10.0.0.0/8';
    await expect(
      verifyCronSecret(
        req({ 'x-cron-secret': 'super-secret-cron-value', 'x-forwarded-for': '10.4.2.9' }),
      ),
    ).resolves.toBe(false);
  });
});

describe('verifyCronSecret — HMAC signature (#1165)', () => {
  const body = JSON.stringify({ run: 'now' });
  const sign = (key: string, payload: string) =>
    'sha256=' + createHmac('sha256', key).update(payload).digest('hex');

  it('is not enforced when CRON_SIGNING_KEY is unset (backwards compatible)', async () => {
    await expect(
      verifyCronSecret(req({ 'x-cron-secret': 'super-secret-cron-value' })),
    ).resolves.toBe(true);
  });

  it('accepts a correct signature over the raw body', async () => {
    process.env['CRON_SIGNING_KEY'] = 'signing-key-123';
    await expect(
      verifyCronSecret(
        req({ 'x-cron-secret': 'super-secret-cron-value', 'x-cron-signature': sign('signing-key-123', body) }),
        { rawBody: body },
      ),
    ).resolves.toBe(true);
  });

  it('rejects when the signature header is missing', async () => {
    process.env['CRON_SIGNING_KEY'] = 'signing-key-123';
    await expect(
      verifyCronSecret(req({ 'x-cron-secret': 'super-secret-cron-value' }), { rawBody: body }),
    ).resolves.toBe(false);
  });

  it('rejects a signature computed with the wrong key', async () => {
    process.env['CRON_SIGNING_KEY'] = 'signing-key-123';
    await expect(
      verifyCronSecret(
        req({ 'x-cron-secret': 'super-secret-cron-value', 'x-cron-signature': sign('wrong-key', body) }),
        { rawBody: body },
      ),
    ).resolves.toBe(false);
  });

  it('rejects a valid signature over a tampered body', async () => {
    process.env['CRON_SIGNING_KEY'] = 'signing-key-123';
    await expect(
      verifyCronSecret(
        req({ 'x-cron-secret': 'super-secret-cron-value', 'x-cron-signature': sign('signing-key-123', body) }),
        { rawBody: '{"run":"later"}' },
      ),
    ).resolves.toBe(false);
  });
});
