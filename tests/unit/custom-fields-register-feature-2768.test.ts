/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2768 — `POST /api/tenant/custom-fields?action=register-feature` cannot register a feature.
 *
 * The branch (app/api/tenant/custom-fields/route.ts:181-204 at the base commit) answered
 * the write with `SELECT public.register_feature(name, description, version,
 * metadataKeys, entities, requiresTables)` — six arguments. `public.register_feature`
 * is declared with three (drizzle/migrations/0032_missing_db_functions.sql:188), and its
 * body inserts into `feature_flags` (`:193`), a table no migration creates; the one that
 * exists is `feature_registry` (drizzle/migrations/0000_init.sql:51, its unique column is
 * `feature_name` at `:64`, not the `name` the `ON CONFLICT` targets). Measured on a
 * scratch cluster with `0000_init.sql` and `0032` applied: the call the route builds — six
 * bare literals, no casts — raises `function public.register_feature(unknown, unknown,
 * unknown, unknown, unknown, unknown) does not exist`; at the function's own arity it
 * raises `relation "feature_flags" does not exist`; and with `feature_flags` hand-created
 * so the statement can run, it succeeds and `feature_registry` still holds **0 rows** —
 * while the list at `route.ts:75-78` reads `featureRegistry`, filtered on `enabled = true`.
 *
 * `execute` below is not a recorder: it renders the statement the route built and answers
 * the way that cluster did, arity first, then the missing relation. So the route that
 * calls the function fails these tests for the same reason it fails in production, and the
 * `insert` fake applies `onConflictDoNothing` against the rows it already holds, so the
 * re-register case is the database's answer rather than a mock's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dialect = new PgDialect({} as never);

interface RegistryRow {
  featureName: string; description: string | null; version: string;
  enabled: boolean; metadataKeys: unknown; entities: unknown; requiresTables: unknown;
}

let inserts: RegistryRow[] = [];
let written: (RegistryRow & { conflicted: boolean })[] = [];
let executes: { sql: string; params: unknown[] }[] = [];
let body: Record<string, unknown> = {};
let action = 'register-feature';

/** Postgres' own answer to `SELECT public.register_feature(…)`: by signature, then by table. */
function answerRegisterFeature(rendered: { sql: string; params: unknown[] }): Error | undefined {
  if (!/register_feature/i.test(rendered.sql)) return undefined;
  // The route's template splices every argument as a bare literal, with no `::jsonb`
  // cast, so this is the signature Postgres reports for the call it actually makes —
  // measured verbatim on the scratch cluster, not derived from the function's body.
  if (rendered.params.length !== 3) {
    const types = rendered.params.map(() => 'unknown');
    return new Error(`function public.register_feature(${types.join(', ')}) does not exist`);
  }
  return new Error('relation "feature_flags" does not exist');
}

function render(fragment: unknown) {
  const q = dialect.sqlToQuery(fragment as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

const mockDb: Record<string, unknown> = {
  insert: vi.fn(() => ({
    values: (row: RegistryRow) => ({
      onConflictDoNothing: (config: { target?: unknown }) => {
        const target = config?.target as unknown;
        // The conflict target is a column of the table; the route passes
        // featureRegistry.featureName, whose name is what Postgres matches on.
        const key = target && typeof target === 'object' && 'name' in (target as object)
          ? String((target as { name?: string }).name)
          : undefined;
        const clash = key === 'feature_name'
          && inserts.some(r => r.featureName === row.featureName);
        if (!clash) inserts.push(row);
        written.push({ ...row, conflicted: clash });
        return Promise.resolve({ rows: [], rowCount: clash ? 0 : 1 });
      },
    }),
  })),
  execute: vi.fn((fragment: unknown) => {
    const rendered = render(fragment);
    executes.push(rendered);
    const err = answerRegisterFeature(rendered);
    return err ? Promise.reject(err) : Promise.resolve({ rows: [], rowCount: 1 });
  }),
  query: {
    customFieldDefs: { findMany: vi.fn(async () => []) },
    featureRegistry: {
      findMany: vi.fn(async () => inserts.filter(r => r.enabled === true)),
    },
  },
  select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/validate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/validate')>('@/lib/api/validate');
  return { ...actual, readJsonBody: async () => body };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/custom-fields/route');

beforeEach(() => {
  inserts = [];
  written = [];
  executes = [];
  action = 'register-feature';
  body = {
    featureName: 'cf_notes',
    description: 'custom fields on notes',
    version: '1.0.0',
    metadataKeys: ['note_kind'],
    entities: ['task'],
    requiresTables: ['notes'],
  };
  vi.clearAllMocks();
});

async function post(ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(`http://localhost:3000/api/tenant/custom-fields?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  return (route.POST as (req: NextRequest) => Promise<Response>)(req);
}

const SUPER: AuthContext = {
  userId: ADMIN, tenantId: TENANT, roleSlug: 'superadmin', permissions: {},
  isAdmin: true, isSuperAdmin: true,
} as unknown as AuthContext;

const STAFF: AuthContext = {
  userId: ADMIN, tenantId: TENANT, roleSlug: 'ops', permissions: { 'customFields.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

describe('registering a feature writes the registry (#2768)', () => {
  it('answers 200 rather than raising out of the write', async () => {
    const res = await post(SUPER);
    const json = await res.json() as { message?: string };
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.message).toContain('cf_notes');
  });

  it('never calls the function, and never names the table that does not exist', async () => {
    await post(SUPER);
    expect(executes, `the route still ran: ${executes.map(e => e.sql).join(' | ')}`).toHaveLength(0);
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(written)).not.toMatch(/feature_flags/);
  });

  it('writes the row the list endpoint reads, keyed by the column that is unique', async () => {
    await post(SUPER);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.featureName).toBe('cf_notes');
    expect(inserts[0]!.description).toBe('custom fields on notes');
    expect(inserts[0]!.version).toBe('1.0.0');
  });

  it('stores the three jsonb lists the endpoint exists to collect', async () => {
    await post(SUPER);
    expect(inserts[0]!.metadataKeys).toEqual(['note_kind']);
    expect(inserts[0]!.entities).toEqual(['task']);
    expect(inserts[0]!.requiresTables).toEqual(['notes']);
  });

  it('registers without activating, since the list at :75-78 filters on enabled', async () => {
    await post(SUPER);
    expect(inserts[0]!.enabled).toBe(false);
  });

  it('defaults an absent description, version and list rather than storing undefined', async () => {
    body = { featureName: 'cf_notes' };
    await post(SUPER);
    expect(inserts[0]!.description).toBeNull();
    expect(inserts[0]!.version).toBe('1.0.0');
    expect(inserts[0]!.metadataKeys).toEqual([]);
    expect(inserts[0]!.entities).toEqual([]);
    expect(inserts[0]!.requiresTables).toEqual([]);
  });

  it('a second registration of the same name is a no-op, not a crash and not a duplicate', async () => {
    await post(SUPER);
    body = { featureName: 'cf_notes', description: 'changed', version: '2.0.0' };
    const res = await post(SUPER);
    expect(res.status, await res.text().then(() => 'second call')).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(written[1]!.conflicted).toBe(true);
    expect(inserts[0]!.description).toBe('custom fields on notes');
  });
});

describe('who may register (#2768 does not widen the gate)', () => {
  it('a caller who is not super admin is a 403 and writes nothing', async () => {
    const res = await post(STAFF);
    expect(res.status, await res.text()).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it('a body without featureName is a 400 and writes nothing', async () => {
    body = { description: 'no name' };
    const res = await post(SUPER);
    expect(res.status, await res.text()).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});
