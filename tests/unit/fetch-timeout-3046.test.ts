/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3046 — two server-side fetch calls had no deadline: the login server
 * action's self-call to /api/auth/login and the integrations SDK's
 * forms.submit (which bypassed the client's own req() 15s timeout). A hung
 * upstream pinned the handler forever. Both now pass
 * AbortSignal.timeout(...); these tests pin that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT'); }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));

import { loginAction } from '@/app/auth/login/actions';
import NuCRMClient from '@/lib/integrations/sdk';

describe('login self-fetch has a bounded deadline (#3046)', () => {
  let origFetch: typeof globalThis.fetch;
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = origFetch; });

  it('passes an AbortSignal.timeout to the self-call', async () => {
    let seenSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as never;

    const fd = new FormData();
    fd.set('email', 'a@b.test'); fd.set('password', 'x');
    // NOTE: the real redirect() throws NEXT_REDIRECT, which this action's
    // catch has always swallowed (pre-existing quirk, no UI caller). We only
    // care here that the outbound self-call carries a timeout signal.
    await loginAction(fd).catch(() => undefined);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it('answers a retryable message when the deadline aborts', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    }) as never;

    const fd = new FormData();
    fd.set('email', 'a@b.test'); fd.set('password', 'x');
    const res = await loginAction(fd);
    expect(res).toEqual({ error: 'Login is taking too long — please try again' });
  });
});

describe('integrations SDK forms.submit is timed out (#3046)', () => {
  let origFetch: typeof globalThis.fetch;
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = origFetch; });

  it('attaches an AbortSignal so no endpoint can hang unbounded', async () => {
    let seenSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as never;

    const client = new NuCRMClient({ baseUrl: 'https://x.test', apiKey: 'k', tenantId: 't' });
    await client.forms.submit('f-1', { a: 1 });

    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it('every raw fetch in the pinned files carries a timeout signal', () => {
    // Source-matrix guard: a future fetch() without AbortSignal.timeout in
    // these files is exactly the #3046 regression.
    for (const file of ['app/auth/login/actions.ts', 'lib/integrations/sdk.ts']) {
      const src = readFileSync(file, 'utf8');
      const fetches = (src.match(/await fetch\(|\bfetch\(`/g) ?? []).length;
      const timeouts = (src.match(/AbortSignal\.timeout/g) ?? []).length;
      expect(timeouts, `${file}: fetch calls without a timeout`).toBeGreaterThanOrEqual(fetches);
    }
  });
});
