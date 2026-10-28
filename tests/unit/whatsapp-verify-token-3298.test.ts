/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3298's adjacent note — the Meta webhook handshake compared `hub.verify_token`
 * with `===`, which is both a non-constant-time comparison of a secret and a
 * fail-open on the empty side: an operator who ships `WHATSAPP_WEBHOOK_VERIFY_TOKEN=`
 * with no value (a blank line in an env file, not a missing one) and a caller
 * sending `hub.verify_token=` satisfy `'' === ''`, because `URLSearchParams.get`
 * returns the empty string rather than null, and the route hands back the challenge
 * — the channel subscribes with no credential at all.
 *
 * `lib/crypto.verifySecret` is the repo's answer — length-checked, `timingSafeEqual`
 * on every path, and it returns false when both sides are empty. The same helper
 * `lib/auth/cron.ts` uses, which is the point: one comparison, not one per route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/queue', () => ({ addJob: vi.fn(async () => undefined) }));
vi.mock('@/lib/whatsapp/webhook-processor', () => ({
  processWhatsAppPayload: vi.fn(async () => undefined),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({ apiError: vi.fn(() => Response.json({ error: 'Internal error' }, { status: 500 })) }));

async function verify(query: string) {
  const { GET } = await import('@/app/api/webhooks/whatsapp/route');
  const req = { url: `http://localhost/api/webhooks/whatsapp?${query}` } as never;
  const res = await GET(req);
  return { status: res.status, text: await res.text() };
}

const ENV = 'WHATSAPP_WEBHOOK_VERIFY_TOKEN';
const saved = process.env[ENV];

beforeEach(() => { vi.resetModules(); });
beforeEach(() => { process.env[ENV] = 'secret-verify-token'; });
afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
});

describe('GET /api/webhooks/whatsapp handshake compares the verify token safely (#3298)', () => {
  it('subscribes with the challenge when the token matches', async () => {
    const res = await verify('hub.mode=subscribe&hub.verify_token=secret-verify-token&hub.challenge=424242');
    expect(res.status).toBe(200);
    expect(res.text).toBe('424242');
  });

  it('refuses a wrong token', async () => {
    const res = await verify('hub.mode=subscribe&hub.verify_token=guess&hub.challenge=424242');
    expect(res.status).toBe(403);
  });

  it('refuses a missing token', async () => {
    const res = await verify('hub.mode=subscribe&hub.challenge=424242');
    expect(res.status).toBe(403);
  });

  it('refuses when the operator left the verify token unset and the caller sends the empty string', async () => {
    // The `===` this replaces answered 200 here: `'' === ''`.
    delete process.env[ENV];
    const res = await verify('hub.mode=subscribe&hub.verify_token=&hub.challenge=424242');
    expect(res.status).toBe(403);
  });

  it('refuses when the configured token is blank, whatever the caller sends', async () => {
    process.env[ENV] = '';
    const res = await verify('hub.mode=subscribe&hub.verify_token=&hub.challenge=424242');
    expect(res.status).toBe(403);
  });
});
