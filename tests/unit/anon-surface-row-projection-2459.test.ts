/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2459: routes the edge lets through without a session must name the columns
 * they move, exactly like `app/api/public/**` has since #2440/#2443.
 *
 * `proxy.ts:382` returns a plain pass-through for any path matching
 * `PUBLIC_PATHS`/`PUBLIC_PREFIXES` and never consults a session, so the
 * anonymous surface is 79 route files, not the 14 the projection guard walks.
 * This file covers the three of those 79 that had a closed, provably-sufficient
 * field set: the portal login and the inbound API-key lookup (both tables' rows
 * carry a credential) and the public form post's contact lookup.
 *
 * It also pins the one site on that surface that must stay whole-row, because
 * projecting it would corrupt data rather than protect it — see the comment at
 * `app/api/forms/submit/route.ts` and the measurement in #2459.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableName } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const TOKEN = 'ptok-0123456789abcdef';
const ROOT = join(import.meta.dirname!, '..', '..');

/** Full rows, as the database would hand them back to an unprojected read. */
const FULL_ROWS: Record<string, Record<string, unknown>> = {
  platform_settings: {
    id: 's1', tenantId: 't1', key: 'portal_config',
    value: { enabled: true, allow_quotes: true, allow_invoices: true, allow_cases: false },
    createdBy: 'leaked-by-id', createdAt: new Date('2026-01-01'),
  },
  portal_clients: {
    id: 'c1', tenantId: 't1', name: 'Ada', email: 'ada@example.com',
    accessToken: TOKEN, expiresAt: new Date('2030-01-01'),
    isActive: true, lastLoginAt: new Date('2026-01-02'),
    createdBy: 'someone-who-should-not-travel', createdAt: new Date('2026-01-01'),
  },
};

const seen: { table: string; projection: Record<string, unknown> | undefined }[] = [];

function projectRow(full: Record<string, unknown>, projection?: Record<string, unknown>) {
  // No projection is `SELECT *`: the row keeps every column it has.
  if (!projection) return { ...full };
  const out: Record<string, unknown> = {};
  for (const [alias, column] of Object.entries(projection)) {
    const dbName = (column as { name?: string } | undefined)?.name;
    for (const key of [alias, dbName]) {
      if (key !== undefined && key in full) { out[alias] = full[key]; break; }
    }
  }
  return out;
}

function chainFor(table: string, projection?: Record<string, unknown>) {
  const full = FULL_ROWS[table];
  if (!full) throw new Error(`fake db has no rows for table "${table}"`);
  const rows = [projectRow(full, projection)];
  const chain: Record<string, unknown> = {};
  for (const m of ['where', 'limit', 'offset', 'orderBy']) chain[m] = vi.fn(() => chain);
  chain.then = (onFulfilled: (r: unknown) => unknown) => Promise.resolve(rows).then(onFulfilled);
  return chain;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn((projection?: Record<string, unknown>) => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const name = getTableName(table);
        seen.push({ table: name, projection });
        return chainFor(name, projection);
      },
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    })),
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimiter: { check: vi.fn().mockResolvedValue({ allowed: true }) },
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

function post(body: Record<string, unknown>) {
  return new Request('http://localhost/api/tenant/portal/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const TENANT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  seen.length = 0;
  vi.resetModules();
});

describe('GET /api/tenant/portal/login reads (#2459)', () => {
  it('names the five portal_clients columns the handler actually uses', async () => {
    const { POST } = await import('@/app/api/tenant/portal/login/route');
    const res = await POST(post({ email: 'ada@example.com', token: TOKEN, tenant_id: TENANT }));
    expect(res.status).toBe(200);

    const clientRead = seen.find((s) => s.table === 'portal_clients');
    expect(clientRead, 'the portal_clients read was not recorded').toBeDefined();
    expect(Object.keys(clientRead!.projection ?? {}).sort()).toEqual([
      'accessToken', 'email', 'expiresAt', 'id', 'name',
    ]);
  });

  it('never holds the five columns it did not ask for', async () => {
    // The guard is textual: it proves a projection exists, not which columns it
    // names. This is the behavioural half — with the fake applying drizzle's
    // aliasing, a row that still carries `createdBy`/`lastLoginAt` means the
    // projection widened, and the credential travelled with it.
    const { POST } = await import('@/app/api/tenant/portal/login/route');
    const res = await POST(post({ email: 'ada@example.com', token: TOKEN, tenant_id: TENANT }));
    const body = await res.json() as Record<string, unknown>;

    expect(JSON.stringify(body)).not.toContain('someone-who-should-not-travel');
    expect(JSON.stringify(body)).not.toContain('lastLoginAt');
    expect(body.client).toEqual({ id: 'c1', name: 'Ada', email: 'ada@example.com' });
  });

  it('issues no credential in the response body, only the hashed session cookie', async () => {
    const { POST } = await import('@/app/api/tenant/portal/login/route');
    const res = await POST(post({ email: 'ada@example.com', token: TOKEN, tenant_id: TENANT }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(TOKEN);
    const cookie = res.headers.getSetCookie().join('\n');
    expect(cookie).toContain('nucrm_portal_session');
    // The cookie stores a hash, not the token (#1179): decoding it must not
    // yield the credential either, or the projection change is cosmetic.
    const raw = /nucrm_portal_session=([^;]*)/.exec(cookie)?.[1];
    expect(Buffer.from(raw ?? '', 'base64url').toString('utf8')).not.toContain(TOKEN);
  });

  it('still answers 401 for a wrong token, with no row detail either', async () => {
    const { POST } = await import('@/app/api/tenant/portal/login/route');
    const res = await POST(post({ email: 'ada@example.com', token: 'not-the-token', tenant_id: TENANT }));
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  });
});

describe('the anonymous surface keeps its one measured exception', () => {
  const forms = readFileSync(join(ROOT, 'app/api/forms/submit/route.ts'), 'utf8');
  const relational = [...forms.matchAll(
    /(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+)?(?:tx|db)\.query\.contacts\.findFirst\(\{[\s\S]*?\n\s*\}\)/g,
  )];

  it('projects the contact lookup that only needs id and tags', () => {
    const scoped = relational.find((m) => m[1] === 'existing');
    expect(scoped).toBeDefined();
    const columns = /columns:\s*\{([^}]*)\}/.exec(scoped![0])?.[1] ?? '';
    expect(columns.replace(/\s/g, '')).toBe('id:true,tags:true');
  });

  it('leaves exactly one whole-row read, and it is the formula-engine input', () => {
    // Not an oversight. syncCalculatedFields (lib/formula/sync.ts:18) passes
    // recordData straight into a tenant-authored formula evaluation, so naming
    // columns here silently drops the columns those formulas reference. If this
    // count grows, the new site has to be measured the same way before it is
    // allowed to stay wide — see #2459.
    const unprojected = relational.filter((m) => !/\bcolumns:/.test(m[0]));
    expect(unprojected).toHaveLength(1);
    expect(unprojected[0][1]).toBe('fullContact');
    expect(forms).toContain('WHOLE ROW BY DESIGN');
  });
});

describe('the anonymous API-key lookup (#2459)', () => {
  const hook = readFileSync(join(ROOT, 'app/api/webhooks/inbound/route.ts'), 'utf8');
  const read = /const row = await db\.query\.apiKeys\.findFirst\(\{[\s\S]*?\n\s*\}\);/.exec(hook);

  it('names five of api_keys 13 columns', () => {
    // resolveApiKey hands the whole row to both callers, so the row type is the
    // surface here, not just the response. tsc is what proves five is *enough*
    // (a missing field is TS2339 at the use site); this proves it is *not more*.
    expect(read, 'the api_keys read was not found — did its shape change?').toBeDefined();
    const columns = /columns:\s*\{([^}]*)\}/.exec(read![0])?.[1] ?? '';
    const names = columns.split(',').map((s) => s.split(':')[0]?.trim()).filter(Boolean).sort();
    expect(names).toEqual(['id', 'name', 'prefix', 'tenantId', 'userId']);
  });

  it('never asks for the credential column back', () => {
    // key_hash is what the sha256 above compares against. Reading it into the
    // handler adds nothing the WHERE does not already do, and it is the one
    // column that would turn a future `...row` into a key disclosure.
    expect(read![0]).not.toMatch(/keyHash:\s*true/);
    expect(hook).toContain('key_hash');
  });
});
