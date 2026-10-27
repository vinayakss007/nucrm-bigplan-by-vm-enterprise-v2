/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3299 — the `webhooks` and `export-csv` queue consumers POST to a tenant-supplied URL with a bare
 * `fetch`, while the other five delivery sites of the same feature use `lib/security/ssrf`'s
 * `safeFetch`.
 *
 * The two gates are not the same gate. `checkSaveTimeUrlSafety` → `assertSafeUrl` inspects the
 * hostname *string*; `safeFetch` → `resolveAndValidateIp` resolves it and refuses any answer that is
 * private/reserved before a socket is opened, then re-validates every redirect hop. A name that
 * resolves publicly at save time and to the metadata address by delivery time passes the save gate —
 * and on these two paths nothing else is checked.
 *
 * So the harness controls DNS. A job here is refused because the fake resolver said `169.254.169.254`,
 * which is precisely the claim the issue makes; nothing is stubbed out of the failure path, and the
 * assertion on every block is that **no socket was opened** rather than that an error string appeared.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type JobProcessor = (job: { id: string; data: Record<string, unknown> }) => Promise<unknown>;

const PUBLIC_IP = '93.184.216.34';
const METADATA_IP = '169.254.169.254';
const HOOK_URL = 'https://hook.tenant-invalid.test/orders';
const CALLBACK_URL = 'https://callback.tenant-invalid.test/done';
const SIGNATURE = 'sha256=deadbeef';

const H = vi.hoisted(() => ({
  processors: new Map<string, JobProcessor>(),
  fetches: [] as { url: string; headers: Record<string, string>; body: string }[],
  /** hostname → the addresses it answers. Absent means the name does not resolve. */
  dns: {} as Record<string, string[]>,
  lookups: [] as string[],
}));

vi.mock('dns/promises', () => ({
  resolve4: async (hostname: string) => {
    H.lookups.push(hostname);
    return (H.dns[hostname] ?? []).map((address) => ({ address, ttl: 60 }));
  },
  resolve6: async () => [],
}));

vi.mock('bullmq', () => {
  class UnrecoverableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnrecoverableError';
    }
  }
  return {
    Worker: vi.fn(function MockWorker(name: string, processor: JobProcessor) {
      H.processors.set(name, processor);
      return { on: vi.fn(), close: vi.fn(async () => {}), isRunning: () => true };
    }),
    QueueEvents: vi.fn(function MockQueueEvents() {
      return { on: vi.fn(), close: async () => {} };
    }),
    Queue: vi.fn(function MockQueue() {
      return { getJob: async () => null, close: async () => {} };
    }),
    UnrecoverableError,
  };
});

vi.mock('ioredis', () => ({
  default: vi.fn(function MockIORedis() {
    return { on: vi.fn(), quit: vi.fn(async () => {}), disconnect: vi.fn(), set: vi.fn(async () => 'OK') };
  }),
  Redis: vi.fn(function MockRedis() {
    return { on: vi.fn(), quit: vi.fn(async () => {}), publish: vi.fn(async () => 0) };
  }),
}));

vi.mock('@/lib/secrets-file', () => ({ materializeFileSecrets: vi.fn() }));
vi.mock('@/lib/process-errors', () => ({ registerProcessErrorHandlers: vi.fn() }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/realtime/publish', () => ({ publishNewNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/service', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
// The CSV bytes are not the subject; the socket the callback opens with them is.
vi.mock('@/lib/export', () => ({ generateExportData: vi.fn(async () => 'name,email\nAcme,a@invalid.test') }));

const WEBHOOK_JOB = {
  url: HOOK_URL,
  payload: { event: 'deal.updated', secret: 'payload-must-not-escape' },
  headers: { 'X-NuCRM-Signature': SIGNATURE },
  webhookId: 'wh-1',
  deliveryId: null,
};

const EXPORT_JOB = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000002',
  payload: { type: 'contacts', filters: {}, callbackUrl: CALLBACK_URL },
};

async function run(queue: string, data: Record<string, unknown>): Promise<unknown> {
  const processor = H.processors.get(queue);
  if (!processor) throw new Error(`worker.ts registers no processor for ${queue}`);
  return processor({ id: 'job-1', data });
}

beforeEach(async () => {
  H.fetches = [];
  H.lookups = [];
  H.dns = { 'hook.tenant-invalid.test': [PUBLIC_IP], 'callback.tenant-invalid.test': [PUBLIC_IP] };
  H.processors.clear();
  vi.resetModules();
  delete process.env['NUCRM_ALLOWED_WEBHOOK_HOSTS'];
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    H.fetches.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ''),
    });
    return { ok: true, status: 200, statusText: 'OK', headers: new Headers(), text: async () => 'ok', json: async () => ({}) };
  }));
  await import('@/worker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('#3299: the webhooks consumer resolves before it connects', () => {
  it('a public target is delivered — through the gate, which is what the delivery is now conditioned on', async () => {
    const out = await run('webhooks', WEBHOOK_JOB);
    expect(out).toMatchObject({ delivered: true });
    expect(H.fetches).toHaveLength(1);
    expect(H.fetches[0]!.url).toBe(HOOK_URL);
    expect(H.fetches[0]!.headers['X-NuCRM-Signature']).toBe(SIGNATURE);
    // The guard that stops this being "block everything": the answer was checked, not skipped.
    expect(H.lookups).toContain('hook.tenant-invalid.test');
  });

  it('a name that rebinds to the metadata address never opens a socket', async () => {
    H.dns['hook.tenant-invalid.test'] = [METADATA_IP];
    await expect(run('webhooks', WEBHOOK_JOB)).rejects.toThrow();
    expect(H.fetches).toHaveLength(0);
    expect(JSON.stringify(H.fetches)).not.toContain('payload-must-not-escape');
  });

  it('…and the refusal is not retried, because the address stays private', async () => {
    H.dns['hook.tenant-invalid.test'] = [METADATA_IP];
    const err = await run('webhooks', WEBHOOK_JOB).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('UnrecoverableError');
    expect((err as Error).message).toMatch(/SSRF|blocked/i);
  });

  it('a loopback IP literal is refused without even asking DNS', async () => {
    const job = { ...WEBHOOK_JOB, url: 'http://127.0.0.1:3099/api/metrics' };
    await expect(run('webhooks', job)).rejects.toThrow();
    expect(H.fetches).toHaveLength(0);
    expect(H.lookups).toEqual([]);
  });

  it('a redirect hop onto a private address is refused too, so the first answer is not the only check', async () => {
    H.dns['hook.tenant-invalid.test'] = [PUBLIC_IP];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      H.fetches.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? '') });
      return {
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: new Headers({ location: `http://${METADATA_IP}/latest/meta-data/` }),
        text: async () => '',
      };
    }));
    await expect(run('webhooks', WEBHOOK_JOB)).rejects.toThrow(/SSRF|blocked/i);
    // One wire attempt — the first hop. Following the redirect would have been the second, and a bare
    // `fetch` follows 3xx by default, which is how a public name smuggles a request to the metadata IP.
    expect(H.fetches).toHaveLength(1);
  });
});

describe('#3299: the export-csv consumer takes the same gate', () => {
  it('a public callback gets the CSV', async () => {
    const out = await run('export-csv', EXPORT_JOB);
    expect(out).toMatchObject({ rows: 1 });
    expect(H.fetches).toHaveLength(1);
    expect(H.fetches[0]!.url).toBe(CALLBACK_URL);
    expect(H.fetches[0]!.body).toContain('Acme');
  });

  it('a callback that rebinds to a private address never receives the export', async () => {
    H.dns['callback.tenant-invalid.test'] = ['10.0.0.7'];
    await expect(run('export-csv', EXPORT_JOB)).rejects.toThrow();
    expect(H.fetches).toHaveLength(0);
    expect(JSON.stringify(H.fetches)).not.toContain('Acme');
  });
});

describe('#3299: the file itself names the gate, so a fifth site cannot silently skip it', () => {
  it('neither consumer reaches for a raw fetch on a URL-shaped variable', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('worker.ts', 'utf8');
    // worker.ts:353-ish is the Meta Graph call: its host is a literal and only phoneNumberId is
    // interpolated, which the issue excludes from scope. Everything else must go through safeFetch.
    const raw = [...src.matchAll(/await fetch\(\s*([A-Za-z_][\w.]*)/g)].map((m) => m[1]);
    expect(raw).toEqual([]);
    expect(src).toContain('safeFetch');
  });
});
