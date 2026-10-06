/**
 * #2399 — one signing scheme for `X-NuCRM-Signature`.
 *
 * `POST /api/tenant/webhooks/[id]/test` signed `SHA-256(body ‖ secret)` while
 * `fireWebhooks` and the manual retry send `HMAC-SHA256(secret, body)`. Two
 * byte-identical bodies under one secret produced two header values, so a
 * receiver that verified the way NuCRM's own docs describe rejected every test
 * delivery — the button reported `failed` for a webhook that was configured
 * perfectly. Same construction is also the length-extension-vulnerable shape
 * HMAC exists to defeat.
 *
 * Fixed by one exported helper every sender calls. The last test walks the
 * source so a fourth parallel implementation cannot be added unnoticed.
 *
 * Also pinned here, because they live in the same handler: the tombstone read
 * (#2390), the per-actor throttle every sibling route has, and "no secret ⇒ no
 * header" rather than an empty `sha256=`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, createHmac } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles stand in for Drizzle's builder chain
type Any = any;

const TENANT = '11111111-1111-4111-8111-111111111111';
const HOOK = '33333333-3333-4333-8333-333333333333';
const SECRET = 'whsec_2c9a1f';
const TARGET = 'https://receiver.example/hook';

const h = vi.hoisted(() => ({
  findFirst: null as unknown,
  findFirstWhere: undefined as unknown,
  safeFetch: [] as Array<{ url: string; init: Any }>,
  rateLimitArgs: [] as string[],
  rateLimitResult: null as unknown,
}));

const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as Any).sql;

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      integrations: {
        findFirst: (opts: Any) => {
          h.findFirstWhere = opts?.where;
          return Promise.resolve(h.findFirst);
        },
      },
    },
  },
}));

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T, >(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({
    userId: '22222222-2222-4222-8222-222222222222', tenantId: TENANT, email: 'a@b.com',
    isAdmin: true, isSuperAdmin: false,
  }),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: (_req: unknown, scope: string, action: string) => {
    h.rateLimitArgs = [scope, action];
    return Promise.resolve(h.rateLimitResult);
  },
}));
vi.mock('@/lib/security/ssrf', () => ({
  safeFetch: (url: string, init: Any) => {
    h.safeFetch.push({ url, init });
    return Promise.resolve({ ok: true, status: 200, text: async () => 'accepted' });
  },
}));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: String(err) }, { status: 500 }),
}));

function post() {
  const req = new Request(`http://x/api/tenant/webhooks/${HOOK}/test`, { method: 'POST' }) as unknown as NextRequest;
  return req;
}

async function callTest() {
  const { POST } = await import('@/app/api/tenant/webhooks/[id]/test/route');
  return POST(post(), { params: Promise.resolve({ id: HOOK }) });
}

function webhookRow(config: Record<string, unknown>) {
  return { id: HOOK, tenantId: TENANT, type: 'webhook', name: 'Ops hook', config, isActive: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findFirst = webhookRow({ url: TARGET, secret: SECRET });
  h.findFirstWhere = undefined;
  h.safeFetch = [];
  h.rateLimitArgs = [];
  h.rateLimitResult = null;
});

describe('webhookSignature() — the contract every sender shares', () => {
  it('is HMAC-SHA256 keyed by the secret, prefixed sha256=', async () => {
    const { webhookSignature } = await import('@/lib/webhooks');
    const body = '{"event":"webhook.test","data":{"message":"hi"}}';
    expect(webhookSignature(SECRET, body)).toBe('sha256=' + createHmac('sha256', SECRET).update(body).digest('hex'));
  });

  it('is NOT the SHA-256(body ‖ secret) the test button used to send', async () => {
    const { webhookSignature } = await import('@/lib/webhooks');
    const body = '{"event":"webhook.test","data":{"message":"hi"}}';
    const legacy = 'sha256=' + createHash('sha256').update(body + SECRET).digest('hex');
    expect(webhookSignature(SECRET, body)).not.toBe(legacy);
  });

  it('is stable for the same bytes and changes with the body', async () => {
    const { webhookSignature } = await import('@/lib/webhooks');
    expect(webhookSignature(SECRET, 'a')).toBe(webhookSignature(SECRET, 'a'));
    expect(webhookSignature(SECRET, 'a')).not.toBe(webhookSignature(SECRET, 'b'));
    expect(webhookSignature('other', 'a')).not.toBe(webhookSignature(SECRET, 'a'));
  });
});

describe('POST /api/tenant/webhooks/[id]/test signs exactly like every real delivery', () => {
  it('sends the same header value fireWebhooks would send for the same bytes', async () => {
    const res = await callTest();
    expect(res.status).toBe(200);
    expect(h.safeFetch).toHaveLength(1);

    const { body } = h.safeFetch[0]!.init;
    const sent = h.safeFetch[0]!.init.headers['X-NuCRM-Signature'] as string;

    // Recomputed from the raw HMAC here, so the assertion cannot be satisfied
    // by the route and the helper agreeing on a wrong scheme.
    expect(sent).toBe('sha256=' + createHmac('sha256', SECRET).update(body as string).digest('hex'));

    const { webhookSignature } = await import('@/lib/webhooks');
    expect(sent).toBe(webhookSignature(SECRET, body as string));
  });

  it('signs the bytes it puts on the wire, not a re-serialisation', async () => {
    await callTest();
    const { body } = h.safeFetch[0]!.init;
    // The signed string must be the body itself: a receiver re-reads the raw
    // request body, so any drift between the two makes a valid signature fail.
    expect(() => JSON.parse(body as string)).not.toThrow();
    expect(JSON.parse(body as string).event).toBe('webhook.test');
    const sent = h.safeFetch[0]!.init.headers['X-NuCRM-Signature'] as string;
    const tampered = 'sha256=' + createHmac('sha256', SECRET).update((body as string) + ' ').digest('hex');
    expect(sent).not.toBe(tampered);
  });

  it('omits the header entirely when the webhook has no secret', async () => {
    h.findFirst = webhookRow({ url: TARGET });
    await callTest();
    const headers = h.safeFetch[0]!.init.headers;
    expect('X-NuCRM-Signature' in headers).toBe(false);
    expect(headers['X-NuCRM-Signature']).toBeUndefined();
  });

  it('does not send an empty "sha256=" for a blank secret', async () => {
    h.findFirst = webhookRow({ url: TARGET, secret: '' });
    await callTest();
    expect('X-NuCRM-Signature' in h.safeFetch[0]!.init.headers).toBe(false);
  });
});

describe('the same handler stops being a hole the delivery path already closed', () => {
  it('excludes tombstoned webhooks from the read (#2390)', async () => {
    h.findFirst = null; // the filter drops the deleted row
    const res = await callTest();
    expect(res.status).toBe(404);

    const sql = render(h.findFirstWhere);
    expect(sql).toMatch(/"?deleted_at"?\s+is null/i);
    expect(sql).toMatch(/"?tenant_id"?\s*=/i);
    expect(sql).toMatch(/"?type"?\s*=/i);
    expect(h.safeFetch).toHaveLength(0);
  });

  it('throttles per actor like its sibling routes', async () => {
    await callTest();
    expect(h.rateLimitArgs).toEqual(['webhooks', 'test']);
  });

  it('returns the throttle response without contacting the receiver', async () => {
    h.rateLimitResult = NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    const res = await callTest();
    expect(res.status).toBe(429);
    expect(h.safeFetch).toHaveLength(0);
  });
});

describe('no sender may grow a fourth signature scheme', () => {
  const roots = [join(process.cwd(), 'app'), join(process.cwd(), 'lib')];

  function tsFiles(dir: string, acc: string[] = []): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return acc;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next') continue;
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) tsFiles(p, acc);
      else if (/\.tsx?$/.test(e)) acc.push(p);
    }
    return acc;
  }

  const files = roots.flatMap((r) => tsFiles(r));
  const senders = files.filter((f) => /headers\[[`"']X-NuCRM-Signature[`"']\]\s*=/.test(readFileSync(f, 'utf-8')));

  it('finds the senders it means to cover', () => {
    expect(senders.length).toBeGreaterThanOrEqual(3);
  });

  it('every one of them calls the shared helper', () => {
    for (const f of senders) {
      const src = readFileSync(f, 'utf-8');
      expect(src, `${f} must sign via webhookSignature()`).toMatch(/webhookSignature\s*\(/);
    }
  });

  it('nothing builds the header from a plain digest any more', () => {
    for (const f of senders) {
      const src = readFileSync(f, 'utf-8');
      expect(src, `${f} re-introduces SHA-256(body ‖ secret)`).not.toMatch(/subtle\.digest\(\s*'SHA-256'/);
      expect(src, `${f} inlines an HMAC instead of calling the helper`).not.toMatch(
        /X-NuCRM-Signature[`"']\]\s*=\s*[`"']sha256=`?\s*\+/,
      );
    }
  });
});
