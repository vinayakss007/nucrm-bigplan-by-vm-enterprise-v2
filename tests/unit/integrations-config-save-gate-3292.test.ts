/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3292 ask 1/2 at the write boundary: the two handlers that put a value into
 * `integrations.config` must refuse an out-of-policy bag *before* the insert, so
 * nothing is left to clean up and the caller gets a field-level 400.
 *
 * Both writers are covered because both are reachable, and the issue's premise
 * that "creating the instance needs a tenant admin" is only true of
 * `POST /api/tenant/integrations` — `POST /api/tenant/plugin-engine` gates on
 * `requireAuth` and CSRF but never on `isAdmin` (measured: `grep -n isAdmin` over
 * that file returns nothing), so a plain member could store the malicious
 * `base_url` there without any admin at all. Fixing only the admin route would
 * leave the wider door open, which is why the policy lives in one helper that
 * both handlers call, and why the PATCH merge is validated too (it is the other
 * way a stored value changes).
 *
 * The provider definition is the real `mailgunProvider`, not a stub: the point of
 * the gate is that the *declared* options are what the server enforces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { mailgunProvider } from '@/lib/integrations/providers/mailgun';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const ROW_ID = '30000000-0000-4000-8000-000000000001';

const METADATA_URL = 'http://169.254.169.254/latest/meta-data/iam/security-credentials';
const EU = 'https://api.eu.mailgun.net/v3';

const harness = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[],
  member: false,
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(handler: T): T => handler,
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(harness.rows),
          orderBy: () => Promise.resolve(harness.rows),
        }),
        orderBy: () => Promise.resolve(harness.rows),
      }),
    }),
    query: {
      integrations: {
        findMany: () => Promise.resolve(harness.rows),
      },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        harness.inserted.push(row);
        return { returning: () => Promise.resolve([{ id: ROW_ID, ...row, createdAt: new Date() }]) };
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => {
        harness.updated.push(updates);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: ROW_ID, updatedAt: new Date('2026-10-10T00:00:00.000Z') }]),
          }),
        };
      },
    }),
  },
}));

vi.mock('@/lib/integrations/registry', () => ({
  getAllProviders: vi.fn(() => [mailgunProvider]),
  getProviderDef: (id: string) => (id === 'mailgun' ? mailgunProvider : undefined),
  executeAction: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    // `member: true` is the shape of a non-admin with no extra permissions:
    // `can()` in lib/auth/middleware.ts returns false for settings.manage here.
    isAdmin: false,
    isSuperAdmin: false,
    roleSlug: harness.member ? 'member' : 'admin',
    permissions: {},
    authMethod: 'session',
    user: { email: 'rep@example.com' },
  })),
  requireCsrf: vi.fn(() => null),
  requireModule: vi.fn(async () => null),
  requireFeature: vi.fn(async () => null),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));

function postRequest(path: string, payload: unknown): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

async function postIntegrations(payload: unknown): Promise<Response> {
  const mod = await import('@/app/api/tenant/integrations/route');
  return (mod.POST as unknown as (r: NextRequest) => Promise<Response>)(postRequest('/api/tenant/integrations', payload));
}

async function postPluginEngine(payload: unknown): Promise<Response> {
  const mod = await import('@/app/api/tenant/plugin-engine/route');
  return (mod.POST as unknown as (r: NextRequest) => Promise<Response>)(postRequest('/api/tenant/plugin-engine', payload));
}

async function patchPluginEngine(payload: unknown): Promise<Response> {
  const mod = await import('@/app/api/tenant/plugin-engine/route');
  return (mod.PATCH as unknown as (r: NextRequest) => Promise<Response>)(
    new Request('http://localhost/api/tenant/plugin-engine', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }) as unknown as NextRequest,
  );
}

/** `requireAuth` above answers `roleSlug: 'member'` when this has been set. */
function asMember() {
  harness.member = true;
}

function details(body: Record<string, unknown>): { field: string; message: string }[] {
  return (body.details ?? []) as { field: string; message: string }[];
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.inserted = [];
  harness.updated = [];
  harness.rows = [];
  harness.member = false;
});

describe('POST /api/tenant/integrations enforces the declared config policy', () => {
  it('stores a legal region', async () => {
    const res = await postIntegrations({
      name: 'Mailgun',
      type: 'mailgun',
      config: { api_key: 'key-1', domain: 'mg.example.com', from_email: 'a@b.co', base_url: EU },
    });
    expect(res.status, JSON.stringify(harness.inserted)).toBe(201);
    expect(harness.inserted[0]!.config).toMatchObject({ base_url: EU });
  });

  it('refuses the metadata address and writes nothing', async () => {
    const res = await postIntegrations({
      name: 'Mailgun',
      type: 'mailgun',
      config: { api_key: 'key-1', domain: 'x', base_url: METADATA_URL },
    });
    expect(res.status).toBe(400);
    expect(harness.inserted).toEqual([]);
    const body = await res.json();
    expect(details(body).map((d) => d.field)).toEqual(['config.base_url']);
    // The rejection names the field and the legal values; it does not echo the
    // stored secret material back out of the 400.
    expect(JSON.stringify(body)).not.toContain('key-1');
  });

  it('refuses a config value that is an absolute URL to a private target', async () => {
    const res = await postIntegrations({
      name: 'Calendar',
      type: 'google',
      config: { calendarId: 'primary', tokenUrl: 'http://127.0.0.1:3001/x' },
    });
    expect(res.status).toBe(400);
    expect(harness.inserted).toEqual([]);
  });

  it('leaves a bag with no urls and no selects alone', async () => {
    const res = await postIntegrations({
      name: 'Slack',
      type: 'slack',
      config: { bot_token: 'slack-token-placeholder', default_channel: '#crm' },
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/tenant/plugin-engine — the door that needed no admin', () => {
  it('refuses an out-of-policy base_url even for a plain member', async () => {
    asMember();
    const res = await postPluginEngine({
      provider_id: 'mailgun',
      name: 'Mailgun',
      config: { api_key: 'key-1', domain: 'x', base_url: METADATA_URL },
    });
    expect(res.status).toBe(400);
    expect(harness.inserted).toEqual([]);
  });

  it('stores a legal region', async () => {
    const res = await postPluginEngine({
      provider_id: 'mailgun',
      name: 'Mailgun',
      config: { api_key: 'key-1', domain: 'mg.example.com', base_url: EU },
    });
    expect(res.status, await res.text()).toBe(201);
    expect(harness.inserted[0]!.config).toMatchObject({ base_url: EU });
  });

  it('validates the merged bag, not just the incoming keys (#2562 shape)', async () => {
    harness.rows = [{
      id: ROW_ID,
      tenantId: TENANT_ID,
      type: 'mailgun',
      name: 'Mailgun',
      config: { api_key: 'stored', domain: 'mg.example.com', base_url: EU },
      isActive: true,
    }];
    const res = await patchPluginEngine({ id: ROW_ID, config: { base_url: METADATA_URL } });
    expect(res.status).toBe(400);
    expect(harness.updated).toEqual([]);
  });

  it('accepts a PATCH that moves between two declared regions', async () => {
    harness.rows = [{
      id: ROW_ID,
      tenantId: TENANT_ID,
      type: 'mailgun',
      name: 'Mailgun',
      config: { api_key: 'stored', domain: 'mg.example.com', base_url: EU },
      isActive: true,
    }];
    const res = await patchPluginEngine({
      id: ROW_ID,
      config: { base_url: 'https://api.mailgun.net/v3' },
    });
    expect(res.status, await res.text()).toBe(200);
    expect(harness.updated[0]!.config).toMatchObject({ base_url: 'https://api.mailgun.net/v3' });
  });
});

describe('the policy helper is what both handlers call', () => {
  it('is exported from its own module rather than inlined per route', async () => {
    const policy = await import('@/lib/integrations/config-policy');
    expect(typeof policy.validateIntegrationConfig).toBe('function');
    expect(typeof policy.integrationConfigResponse).toBe('function');
  });

  it('answers a NextResponse 400 with field-level details, and null when clean', async () => {
    const { integrationConfigResponse, validateIntegrationConfig } = await import('@/lib/integrations/config-policy');
    expect(integrationConfigResponse(mailgunProvider, { base_url: EU })).toBeNull();
    const rejection = integrationConfigResponse(mailgunProvider, { base_url: METADATA_URL });
    expect(rejection).instanceOf(NextResponse);
    expect((rejection as NextResponse).status).toBe(400);
    const body = await (rejection as NextResponse).json();
    expect(details(body)[0]!.field).toBe('config.base_url');
    expect(validateIntegrationConfig(mailgunProvider, { base_url: EU })).toEqual([]);
  });
});
