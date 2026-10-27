/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3328 — OAuth client registration (route wiring + credential shapes).
 *
 * `oauth_clients` had no writer in the app, so `POST /api/auth/oauth/token` answered
 * `invalid_client` for every caller and a fresh workspace could not connect an
 * integration at all. These cases pin the four things that writer must never get
 * wrong, and that a later edit could quietly undo:
 *
 *  - `client_secret` is not in any projection, any `.returning()` or any read response,
 *    so the one-time reveal is the only path the credential leaves the server;
 *  - the audit trail records that a client was created, not what its secret is;
 *  - both credentials are minted server-side — a caller cannot bid for a `client_id`
 *    or supply a secret that already passed through a log;
 *  - `redirect_uris` is written in the exact shape #3324's matcher reads it back, and
 *    a URI that would not survive that round trip is refused at the door.
 *
 * The end-to-end half (register through the route, then authorize → token on the
 * RLS-enforcing role) is tests/integration/oauth-client-registration-3328.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { oauthClients } from '@/drizzle/schema';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { logAudit } from '@/lib/audit';
import {
  newOAuthClientId, newOAuthClientSecret, isRegistrableRedirectUri,
  serializeRedirectUris, parseRedirectUris,
} from '@/lib/auth/oauth-client';
import { registerOAuthClientSchema, updateOAuthClientSchema } from '@/lib/api/schemas';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const USER = 'b2222222-2222-4222-8222-222222222222';
const CLIENT_ROW_ID = 'c3333333-3333-4333-8333-333333333333';
const CB = 'https://partner.example.com/oauth/callback';

const harness = vi.hoisted(() => {
  const state = {
    selectProjections: [] as unknown[],
    selectRows: [] as unknown[],
    insertTable: [] as unknown[],
    insertPayloads: [] as Record<string, unknown>[],
    insertReturning: [] as unknown[],
    insertRows: [] as unknown[],
    updateSetPayloads: [] as Record<string, unknown>[],
    updateReturning: [] as unknown[],
    updateRows: [] as unknown[],
    deleteReturning: [] as unknown[],
    deleteRows: [] as unknown[],
    whereArgs: [] as unknown[],
    throws: {} as { select?: unknown; insert?: unknown; update?: unknown; delete?: unknown },
  };

  /** Passthrough drizzle chain; the terminal call resolves the harness rows. */
  const chain = (
    kind: 'select' | 'insert' | 'update' | 'delete',
    resolve: () => unknown[],
    onReturning?: (arg: unknown) => void,
  ) => {
    const terminal = () => (
      state.throws[kind] !== undefined
        ? Promise.reject(state.throws[kind])
        : Promise.resolve(resolve())
    );
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = (arg: unknown) => { state.whereArgs.push(arg); return c; };
    c.orderBy = () => c;
    c.limit = () => terminal();
    c.returning = (arg?: unknown) => { onReturning?.(arg); return terminal(); };
    c.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => terminal().then(ok, err);
    return c;
  };

  const db = {
    select: vi.fn((projection?: unknown) => {
      state.selectProjections.push(projection ?? null);
      return chain('select', () => state.selectRows);
    }),
    insert: vi.fn((table: unknown) => {
      state.insertTable.push(table);
      const c: Record<string, unknown> = {};
      c.values = (payload: Record<string, unknown>) => {
        state.insertPayloads.push(payload);
        return chain('insert', () => state.insertRows, (arg) => state.insertReturning.push(arg));
      };
      return c;
    }),
    update: vi.fn(() => {
      const c: Record<string, unknown> = {};
      c.set = (payload: Record<string, unknown>) => {
        state.updateSetPayloads.push(payload);
        return chain('update', () => state.updateRows, (arg) => state.updateReturning.push(arg));
      };
      return c;
    }),
    delete: vi.fn(() => chain('delete', () => state.deleteRows, (arg) => state.deleteReturning.push(arg))),
  };

  const mockRequireAuth = vi.fn();
  const mockCan = vi.fn();
  return { state, db, mockRequireAuth, mockCan };
});

vi.mock('@/drizzle/db', () => ({ db: harness.db }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...args: unknown[]) => harness.mockRequireAuth(...args),
  can: (...args: unknown[]) => harness.mockCan(...args),
}));
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
// Keep apiError real (the 23505/22P02 mapping is one of the assertions) but mute
// its reporting side effects.
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));
vi.mock('@/lib/critical-error-alert', () => ({ sendCriticalErrorAlert: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as collection from '@/app/api/tenant/oauth-clients/route';
import * as item from '@/app/api/tenant/oauth-clients/[id]/route';
import * as rotate from '@/app/api/tenant/oauth-clients/[id]/rotate/route';

function request(method: string, body?: unknown): NextRequest {
  return new Request(`http://localhost:3000/api/tenant/oauth-clients`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const params = (id = CLIENT_ROW_ID) => ({ params: Promise.resolve({ id }) });

/** A projection or `.returning()` arg that could hand back the secret. */
function leaksSecret(arg: unknown): boolean {
  if (!arg || typeof arg !== 'object') return false;
  return Object.entries(arg as Record<string, unknown>).some(
    ([alias, col]) =>
      /secret/i.test(alias) ||
      (col as { name?: string })?.name === 'client_secret',
  );
}

const dialect = new PgDialect();

function sqlOf(arg: unknown) {
  // `eq()`/`and()` outside a session build a predicate with no dialect bound in, so
  // `SQL#toQuery()` fails on it; this is the compiler drizzle itself runs on the way
  // to the database, and it gives both the quoted column list and the $-parameters.
  const q = dialect.sqlToQuery(arg as never);
  return { text: q.sql, params: q.params };
}

function firstAuditCall() {
  return vi.mocked(logAudit).mock.calls[0]?.[0] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  const s = harness.state;
  s.selectProjections = []; s.selectRows = []; s.insertTable = [];
  s.insertPayloads = []; s.insertReturning = []; s.insertRows = [];
  s.updateSetPayloads = []; s.updateReturning = []; s.updateRows = [];
  s.deleteReturning = []; s.deleteRows = []; s.whereArgs = [];
  s.throws = {};
  harness.mockRequireAuth.mockResolvedValue({ tenantId: TENANT, userId: USER });
  harness.mockCan.mockReturnValue(true);
});

describe('GET /api/tenant/oauth-clients', () => {
  it('refuses a caller without settings.manage', async () => {
    harness.mockCan.mockReturnValue(false);
    const res = await collection.GET(request('GET'));
    expect(res.status).toBe(403);
    expect(harness.state.selectProjections).toHaveLength(0);
  });

  it('answers { data } and splits redirect_uris into the list the client registered', async () => {
    harness.state.selectRows = [{
      id: CLIENT_ROW_ID, name: 'Partner', client_id: 'oc_abc',
      redirect_uris: `${CB},https://other.example.com/cb`, is_active: true, created_at: new Date(),
    }];
    const json = await (await collection.GET(request('GET'))).json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].redirect_uris).toEqual([CB, 'https://other.example.com/cb']);
  });

  it('never puts client_secret in the projection', async () => {
    await collection.GET(request('GET'));
    expect(leaksSecret(harness.state.selectProjections[0])).toBe(false);
    expect(Object.keys(harness.state.selectProjections[0] as object))
      .toEqual(['id', 'name', 'client_id', 'redirect_uris', 'is_active', 'created_at']);
  });

  it('scopes the read to the caller workspace on SQL level', async () => {
    await collection.GET(request('GET'));
    const { text, params: bound } = sqlOf(harness.state.whereArgs[0]);
    expect(text).toContain('"tenant_id"');
    expect(bound).toContain(TENANT);
  });
});

describe('POST /api/tenant/oauth-clients', () => {
  it('is rate limited as a mutating oauthClients write', async () => {
    harness.state.insertRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_x' }];
    await collection.POST(request('POST', { name: 'Partner', redirect_uris: [CB] }));
    expect(vi.mocked(rateLimitMutating).mock.calls[0]?.slice(1)).toEqual(['oauthClients', 'post']);
  });

  it('refuses a caller without settings.manage before touching the table', async () => {
    harness.mockCan.mockReturnValue(false);
    const res = await collection.POST(request('POST', { name: 'Partner', redirect_uris: [CB] }));
    expect(res.status).toBe(403);
    expect(harness.state.insertPayloads).toHaveLength(0);
  });

  it('registers, answers 201 and reveals the secret exactly once', async () => {
    harness.state.insertRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_placeholder' }];
    const res = await collection.POST(request('POST', { name: 'Partner', redirect_uris: [CB, 'https://b.example.com/cb'] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe(CLIENT_ROW_ID);
    expect(json.client_id).toMatch(/^oc_[0-9a-f]{32}$/);
    expect(json.client_secret).toMatch(/^ocs_[0-9a-f]{64}$/);
    expect(json.redirect_uris).toEqual([CB, 'https://b.example.com/cb']);
    expect(json.warning).toMatch(/never be shown again/i);
  });

  it('writes the row for the caller workspace, active, with URIs in the matcher shape', async () => {
    harness.state.insertRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_x' }];
    await collection.POST(request('POST', { name: 'Partner', redirect_uris: [CB, 'https://b.example.com/cb'] }));
    const payload = harness.state.insertPayloads[0]!;
    expect(payload.tenantId).toBe(TENANT);
    expect(payload.createdBy).toBe(USER);
    expect(payload.isActive).toBe(true);
    expect(payload.redirectUris).toBe(`${CB},https://b.example.com/cb`);
    expect(harness.state.insertTable[0]).toBe(oauthClients);
  });

  it('mints both credentials instead of accepting the caller\'s', async () => {
    harness.state.insertRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_x' }];
    await collection.POST(request('POST', {
      name: 'Partner', redirect_uris: [CB],
      client_id: 'oc_i_chose_this', client_secret: 'the_secret_i_chose',
    }));
    const payload = harness.state.insertPayloads[0]!;
    expect(payload.clientId).not.toBe('oc_i_chose_this');
    expect(payload.clientId).toMatch(/^oc_[0-9a-f]{32}$/);
    expect(payload.clientSecret).not.toBe('the_secret_i_chose');
  });

  it('reads back only the id from the insert', async () => {
    harness.state.insertRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_x' }];
    await collection.POST(request('POST', { name: 'Partner', redirect_uris: [CB] }));
    expect(leaksSecret(harness.state.insertReturning[0])).toBe(false);
    expect(Object.keys(harness.state.insertReturning[0] as object)).toEqual(['id', 'clientId']);
  });

  it('audits the creation without recording the secret', async () => {
    harness.state.insertRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_x' }];
    await collection.POST(request('POST', { name: 'Partner', redirect_uris: [CB] }));
    const entry = firstAuditCall();
    expect(entry.action).toBe('create_oauth_client');
    expect(entry.entityType).toBe('oauth_client');
    expect(entry.entityId).toBe(CLIENT_ROW_ID);
    expect(JSON.stringify(entry.newData)).not.toContain(String(harness.state.insertPayloads[0]!.clientSecret));
    expect(entry.newData).toMatchObject({ name: 'Partner', client_id: 'oc_x' });
  });

  it('calls a 0-row insert a refused write rather than a success', async () => {
    harness.state.insertRows = [];
    const res = await collection.POST(request('POST', { name: 'Partner', redirect_uris: [CB] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/workspace context refused/);
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
  });

  it('answers 409 for a client_id collision, not a 500', async () => {
    harness.state.throws.insert = Object.assign(
      new Error('duplicate key value violates unique constraint "oauth_clients_client_id_key"'),
      { code: '23505', name: 'DatabaseError' },
    );
    const res = await collection.POST(request('POST', { name: 'Partner', redirect_uris: [CB] }));
    expect(res.status).toBe(409);
  });

  it.each([
    ['a non-http scheme', ['javascript:alert(1)'], /scheme/],
    ['a fragment', ['https://x.test/cb#frag'], /fragment/],
    ['the column delimiter', ['https://x.test/a,b'], /comma/],
    ['a relative URL', ['/cb'], /absolute/],
    ['userinfo', ['https://user:pw@x.test/cb'], /userinfo/],
  ])('rejects %s with a field-level 400', async (_label, uris, why) => {
    const res = await collection.POST(request('POST', { name: 'Partner', redirect_uris: uris }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details.some((d: { message: string }) => why.test(d.message))).toBe(true);
    expect(harness.state.insertPayloads).toHaveLength(0);
  });

  it('rejects an empty URI list and a blank name', async () => {
    const empty = await collection.POST(request('POST', { name: 'Partner', redirect_uris: [] }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).details[0].message).toMatch(/At least one redirect URI/);

    const blank = await collection.POST(request('POST', { name: '   ', redirect_uris: [CB] }));
    expect(blank.status).toBe(400);
    expect((await blank.json()).details[0].field).toBe('name');
  });

  it('rejects a malformed JSON body at 400', async () => {
    const bad = new Request('http://localhost:3000/api/tenant/oauth-clients', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":',
    }) as unknown as NextRequest;
    const res = await collection.POST(bad);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/tenant/oauth-clients/[id]', () => {
  const row = {
    id: CLIENT_ROW_ID, name: 'Partner', client_id: 'oc_abc',
    redirect_uris: CB, is_active: true, created_at: new Date(),
  };

  it('maps the wire names onto the columns and nothing else', async () => {
    harness.state.updateRows = [row];
    const res = await item.PATCH(
      request('PATCH', { name: 'Renamed', redirect_uris: [CB, 'https://b.test/cb'], is_active: false }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(harness.state.updateSetPayloads[0]).toEqual({
      name: 'Renamed', redirectUris: `${CB},https://b.test/cb`, isActive: false,
    });
  });

  it('accepts a single field', async () => {
    harness.state.updateRows = [row];
    await item.PATCH(request('PATCH', { is_active: false }), params());
    expect(harness.state.updateSetPayloads[0]).toEqual({ isActive: false });
  });

  it('answers 400 for a body that changes nothing', async () => {
    const res = await item.PATCH(request('PATCH', { unknown_field: 1 }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No fields to update');
    expect(harness.state.updateSetPayloads).toHaveLength(0);
  });

  it('re-validates URIs on the way in', async () => {
    const res = await item.PATCH(request('PATCH', { redirect_uris: ['data:text/html,x'] }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).details[0].field).toBe('redirect_uris');
  });

  it('404s a foreign or trashed row without auditing', async () => {
    harness.state.updateRows = [];
    const res = await item.PATCH(request('PATCH', { name: 'Ghost' }), params());
    expect(res.status).toBe(404);
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
  });

  it('binds both the row id and the caller workspace in the WHERE', async () => {
    harness.state.updateRows = [row];
    await item.PATCH(request('PATCH', { name: 'Renamed' }), params());
    const { text, params: bound } = sqlOf(harness.state.whereArgs[0]);
    expect(text).toContain('"tenant_id"');
    expect(bound).toEqual(expect.arrayContaining([TENANT, CLIENT_ROW_ID]));
  });

  it('never returns the secret and never reads it back from the write', async () => {
    harness.state.updateRows = [row];
    const res = await item.PATCH(request('PATCH', { name: 'Renamed' }), params());
    const json = await res.json();
    expect(json.data.client_secret).toBeUndefined();
    expect(json.data.redirect_uris).toEqual([CB]);
    expect(leaksSecret(harness.state.updateReturning[0])).toBe(false);
  });

  it('audits which fields changed, not their values', async () => {
    harness.state.updateRows = [row];
    await item.PATCH(request('PATCH', { name: 'Renamed', is_active: false }), params());
    expect(firstAuditCall().action).toBe('update_oauth_client');
    expect(firstAuditCall().newData).toEqual({ fields: ['name', 'isActive'] });
  });
});

describe('DELETE /api/tenant/oauth-clients/[id]', () => {
  it('confirms the cascade in the message it returns', async () => {
    harness.state.deleteRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_abc', name: 'Partner' }];
    const res = await item.DELETE(request('DELETE'), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toMatch(/authorization codes and issued tokens were revoked/);
  });

  it('404s a row that is not this workspace\'s', async () => {
    harness.state.deleteRows = [];
    const res = await item.DELETE(request('DELETE'), params());
    expect(res.status).toBe(404);
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
  });

  it('scopes the delete to the caller workspace', async () => {
    harness.state.deleteRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_abc', name: 'Partner' }];
    await item.DELETE(request('DELETE'), params());
    const { text, params: bound } = sqlOf(harness.state.whereArgs[0]);
    expect(text).toContain('"tenant_id"');
    expect(bound).toContain(TENANT);
  });

  it('names the removed client in the audit trail', async () => {
    harness.state.deleteRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_abc', name: 'Partner' }];
    await item.DELETE(request('DELETE'), params());
    expect(firstAuditCall().action).toBe('delete_oauth_client');
    expect(firstAuditCall().oldData).toEqual({ name: 'Partner', client_id: 'oc_abc' });
  });
});

describe('GET /api/tenant/oauth-clients/[id]', () => {
  it('reads one row without the secret, or 404s', async () => {
    harness.state.selectRows = [{
      id: CLIENT_ROW_ID, name: 'Partner', client_id: 'oc_abc',
      redirect_uris: CB, is_active: true, created_at: new Date(),
    }];
    const json = await (await item.GET(request('GET'), params())).json();
    expect(json.data.client_secret).toBeUndefined();
    expect(leaksSecret(harness.state.selectProjections[0])).toBe(false);

    harness.state.selectRows = [];
    expect((await item.GET(request('GET'), params())).status).toBe(404);
  });
});

describe('POST /api/tenant/oauth-clients/[id]/rotate', () => {
  it('replaces only the secret and reveals the new one once', async () => {
    harness.state.updateRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_abc', name: 'Partner' }];
    const res = await rotate.POST(request('POST'), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.client_id).toBe('oc_abc');
    expect(json.client_secret).toMatch(/^ocs_[0-9a-f]{64}$/);
    expect(json.warning).toMatch(/previous one stopped working/);
    const set = harness.state.updateSetPayloads[0]!;
    expect(Object.keys(set)).toEqual(['clientSecret']);
    expect(set.clientSecret).toBe(json.client_secret);
  });

  it('404s a row outside the workspace and answers without a secret', async () => {
    harness.state.updateRows = [];
    const res = await rotate.POST(request('POST'), params());
    expect(res.status).toBe(404);
    expect((await res.json()).client_secret).toBeUndefined();
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
  });

  it('audits the rotation without copying either secret', async () => {
    harness.state.updateRows = [{ id: CLIENT_ROW_ID, clientId: 'oc_abc', name: 'Partner' }];
    await rotate.POST(request('POST'), params());
    expect(firstAuditCall().action).toBe('rotate_oauth_client_secret');
    expect(firstAuditCall().newData).toEqual({ client_id: 'oc_abc' });
    expect(leaksSecret(harness.state.updateReturning[0])).toBe(false);
  });
});

describe('credential and redirect-URI shapes', () => {
  it('mints ids wide enough that the unique index is a formality', () => {
    const ids = new Set(Array.from({ length: 200 }, newOAuthClientId));
    const secrets = new Set(Array.from({ length: 200 }, newOAuthClientSecret));
    expect(ids.size).toBe(200);
    expect(secrets.size).toBe(200);
    // 16 and 32 random bytes, hex-encoded so Buffer.from round-trips byte-exact
    // for the timingSafeEqual comparison in the token route.
    expect(newOAuthClientId()).toHaveLength('oc_'.length + 32);
    expect(newOAuthClientSecret()).toHaveLength('ocs_'.length + 64);
  });

  it.each([
    ['https://app.example.com/cb'],
    ['http://localhost:8080/cb'],
    ['https://app.example.com/deep/path?query=1&x=2'],
    ['https://app.example.com/cb?a=%20b'],
  ])('accepts the registrable URI %s', (uri) => {
    expect(isRegistrableRedirectUri(uri)).toBeNull();
  });

  it('refuses the empty string', () => {
    expect(isRegistrableRedirectUri('')).toBe('empty');
  });

  it('round-trips through the column exactly as #3324 splits it back', () => {
    const uris = ['https://a.test/cb', 'https://b.test/cb?x=1'];
    const stored = serializeRedirectUris(uris);
    expect(stored).not.toContain(' ');
    expect(parseRedirectUris(stored)).toEqual(uris);
    // The matcher compares trimmed entries for exact equality, so every registered
    // URI has to be one of them — a padded join would silently break the second.
    for (const uri of uris) {
      expect(stored.split(',').some((entry) => entry.trim() === uri)).toBe(true);
    }
  });

  it('reads a legacy padded registration back cleanly', () => {
    expect(parseRedirectUris('https://a.test/cb, https://b.test/cb,')).toEqual([
      'https://a.test/cb', 'https://b.test/cb',
    ]);
    expect(parseRedirectUris('')).toEqual([]);
  });

  it('caps the register contract at 20 URIs and a 120-char name', () => {
    expect(registerOAuthClientSchema.safeParse({ name: 'x'.repeat(121), redirect_uris: [CB] }).success).toBe(false);
    const tooMany = Array.from({ length: 21 }, (_, i) => `https://a${i}.test/cb`);
    expect(registerOAuthClientSchema.safeParse({ name: 'x', redirect_uris: tooMany }).success).toBe(false);
    expect(registerOAuthClientSchema.safeParse({ name: 'x', redirect_uris: [CB] }).success).toBe(true);
  });

  it('lets a PATCH carry no fields at all, but not a bad URI', () => {
    expect(updateOAuthClientSchema.safeParse({}).success).toBe(true);
    expect(updateOAuthClientSchema.safeParse({ redirect_uris: ['ftp://x.test/cb'] }).success).toBe(false);
  });
});
