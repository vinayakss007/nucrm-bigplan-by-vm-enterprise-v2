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
import { verifyCronSecret } from '@/lib/auth/cron';

/** Minimal NextRequest stand-in: verifyCronSecret only reads one header. */
function req(headers: Record<string, string> = {}) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as never;
}

const ORIGINAL = process.env['CRON_SECRET'];

beforeEach(() => {
  process.env['CRON_SECRET'] = 'super-secret-cron-value';
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['CRON_SECRET'];
  else process.env['CRON_SECRET'] = ORIGINAL;
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
