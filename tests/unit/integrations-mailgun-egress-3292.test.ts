/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3292 asks 1 and 2, at the call site: `handleMailgun` must issue its request
 * through the SSRF guard, and the region selector must be a choice between two
 * literal Mailgun origins rather than a free-text host.
 *
 * Two properties are pinned here, and they are different properties:
 *
 *   1. a rejected target opens no socket — asserted by `fetch` never being
 *      called, which is the only way to tell "refused" from "sent and ignored";
 *   2. an accepted target reaches exactly the host the tenant chose, with the
 *      `domain` path segment encoded so it cannot climb out of `/v3/<domain>/`.
 *
 * `dns/promises` is stubbed to a public address so the *real* `safeFetch` runs
 * (the guard is part of what is being tested); `globalThis.fetch` stays a spy,
 * because it is the last thing before a socket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IntegrationInstance } from '@/lib/integrations/types';

vi.mock('dns/promises', () => ({
  resolve4: vi.fn(async () => [{ address: '198.121.228.217', ttl: 60 }]),
  resolve6: vi.fn(async () => []),
}));

const TENANT_ID = '10000000-0000-4000-8000-000000000001';

function mailgunInstance(config: Record<string, string>): IntegrationInstance {
  return {
    id: 'inst-3',
    tenantId: TENANT_ID,
    providerId: 'mailgun',
    label: 'Mailgun',
    config: { api_key: 'key-test', domain: 'mg.example.com', from_email: 'noreply@example.com', ...config },
    enabled: true,
    createdAt: new Date().toISOString(),
  };
}

const PARAMS = { to: 'user@example.com', subject: 'Test', body: 'content' };

async function send(config: Record<string, string>) {
  const { executeAction } = await import('@/lib/integrations/registry');
  return executeAction(mailgunInstance(config), 'send_email', PARAMS);
}

const US = 'https://api.mailgun.net/v3';
const EU = 'https://api.eu.mailgun.net/v3';

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ id: '<2026@mg.example.com>', message: 'Queued' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sentUrl(): string {
  return String(fetchSpy.mock.calls[0]?.[0]);
}

describe('the Mailgun endpoint is not tenant-configurable', () => {
  it('sends to the US region by default', async () => {
    const result = await send({});
    expect(result.success).toBe(true);
    expect(sentUrl()).toBe(`${US}/mg.example.com/messages`);
  });

  it('sends to the EU region when that is what was chosen', async () => {
    await send({ base_url: EU });
    expect(sentUrl()).toBe(`${EU}/mg.example.com/messages`);
  });

  it('refuses the instance-metadata address without opening a socket', async () => {
    const result = await send({ base_url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials' });
    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a loopback listener (Grafana/Prometheus on this host, #3273)', async () => {
    for (const internal of ['http://127.0.0.1:3001', 'http://localhost:9090', 'http://[::1]:3000']) {
      const result = await send({ base_url: internal });
      expect(result.success, internal).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a host that merely ends with an allowed Mailgun host', async () => {
    // #3325: substring/suffix matching in an allowlist is not origin equality.
    const result = await send({ base_url: 'https://api.mailgun.net.evil.test/v3' });
    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a plain attacker host even with an https scheme', async () => {
    const result = await send({ base_url: 'https://collector.attacker.test/v3' });
    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a non-parseable value instead of falling back to the default silently', async () => {
    const result = await send({ base_url: 'not a url' });
    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not echo the rejected value back to the caller', async () => {
    const result = await send({ base_url: 'http://169.254.169.254/latest/meta-data/' });
    expect(JSON.stringify(result)).not.toContain('169.254.169.254');
  });
});

describe('the request that is allowed still goes through the guard', () => {
  it('is issued by safeFetch, not by a bare fetch in the handler', async () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'integrations', 'registry.ts'), 'utf8');
    const handler = src.slice(src.indexOf('async function handleMailgun'));
    expect(handler.slice(0, handler.indexOf('\n}\n'))).toMatch(/safeFetch\(/);
    expect(handler.slice(0, handler.indexOf('\n}\n'))).not.toMatch(/await fetch\(/);
    await send({ base_url: EU });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('encodes the domain so it cannot climb out of the /v3/<domain>/ segment', async () => {
    await send({ domain: 'mg.example.com/../messages' });
    expect(sentUrl()).toBe(`${US}/mg.example.com%2F..%2Fmessages/messages`);
  });

  it('still delivers the provider response body to the caller on a legal target', async () => {
    // The read-back is the *other* half of #3292 and is closed by the permission
    // gate on plugin-engine/actions, not here; this pins that the success shape
    // did not change for legitimate Mailgun use.
    const result = await send({});
    expect(result.data).toMatchObject({ id: '<2026@mg.example.com>' });
  });
});
