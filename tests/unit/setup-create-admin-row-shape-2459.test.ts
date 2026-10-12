/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2459: `POST /api/setup/create-admin` is anonymously reachable — `proxy.ts`
 * lists `/api/setup/create-admin` in `PUBLIC_PATHS` and passes it through with
 * no session check; the only gate is the `x-setup-key` comparison, and that
 * exists to stop a second super admin, not to authenticate a caller.
 *
 * Four inserts on that path asked the database for `RETURNING *` and one read
 * asked for the whole plan row, so the super-admin insert handed `password_hash`
 * (just computed from the body the caller sent), `reset_token`, `totp_secret`
 * and `totp_backup_codes` into the transaction's return value. Nothing reached
 * the wire because the response hand-picks its fields — which is the same
 * "safe by discipline" the #2440 ticket was written about.
 *
 * The guard in `scripts/check-public-row-projection.mts` proves the file is
 * clean; the fake below proves the field sets are *sufficient*, by applying
 * drizzle's own projection rule to full rows and recording what was asked for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableName } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import {
  enumerateHandlers,
  findWriteSites,
  findings,
  findReadSites,
  readFindings,
  findRelationalReadSites,
  relationalFindings,
  maskHandlerBodies,
} from '../../scripts/check-public-row-projection.mts';

const ROOT = join(import.meta.dirname!, '..', '..');
const REL = 'app/api/setup/create-admin/route.ts';

/** Values only a whole-row read could put in scope. If any of these reaches the
 *  response, the projection widened. */
const SECRETS: Record<string, unknown> = {
  passwordHash: 'PH-LEAK',
  emailVerifyToken: 'EV-LEAK',
  resetToken: 'RT-LEAK',
  telegramBotToken: 'TB-LEAK',
  totpSecret: 'TS-LEAK',
  totpBackupCodes: ['BC-LEAK'],
};

/** Full rows, the way `SELECT *`/`RETURNING *` would hand them back. */
const FULL_ROWS: Record<string, Record<string, unknown>> = {
  users: {
    id: 'u1', email: 'admin@example.com', fullName: 'Ada Admin', isSuperAdmin: true,
    lastTenantId: null, ...SECRETS,
  },
  tenants: {
    id: 't1', name: 'Acme', slug: 'acme', status: 'active', planId: 'p-enterprise',
    stripeCustomerId: 'cus_LEAK', adminNotes: 'notes_LEAK', settings: { leaked: 1 },
  },
  roles: { id: 'r1', tenantId: 't1', slug: 'admin', permissions: { all: true } },
  pipelines: { id: 'pl1', tenantId: 't1', name: 'Sales Pipeline', isDefault: true },
  plans: { id: 'p-enterprise', name: 'Enterprise', maxUsers: 1_000_000, features: { leaked: true } },
  // These four are written without a `.returning()`, so their rows never reach
  // the handler — they exist so the fake can record the statement.
  tenant_members: { tenantId: 't1', userId: 'u1', roleSlug: 'admin' },
  deal_stages: { tenantId: 't1', pipelineId: 'pl1', name: 'Lead' },
  onboarding_progress: { tenantId: 't1', userId: 'u1', stepName: 'admin_created' },
  sessions: { userId: 'u1', tokenHash: 'tokhash-1' },
};

/** What the fake was asked for, per statement, in source order. */
const asked: { table: string; returning?: string[]; columns?: string[] }[] = [];

function projectRow(full: Record<string, unknown>, names?: string[]) {
  // No names is `*`: the row keeps every column the table has.
  if (!names) return { ...full };
  const out: Record<string, unknown> = {};
  for (const n of names) if (n in full) out[n] = full[n];
  return out;
}

function rowFor(table: unknown) {
  const name = getTableName(table as never);
  const full = FULL_ROWS[name];
  if (!full) throw new Error(`fake db has no rows for "${name}"`);
  return { name, full };
}

const tx: Record<string, unknown> = {
  insert: vi.fn((table: unknown) => {
    const { name, full } = rowFor(table);
    const rec: { table: string; returning?: string[] } = { table: name };
    asked.push(rec);
    const chain: Record<string, unknown> = {
      returning: vi.fn((proj?: Record<string, unknown>) => {
        rec.returning = proj ? Object.keys(proj) : undefined;
        return Promise.resolve([projectRow(full, rec.returning)]);
      }),
      onConflictDoUpdate: vi.fn(() => chain),
      onConflictDoNothing: vi.fn(() => Promise.resolve([])),
      then: (onFulfilled: (r: unknown) => unknown) => Promise.resolve([]).then(onFulfilled),
    };
    return { values: vi.fn(() => chain) };
  }),
  update: vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ count: 0 }])) })),
  })),
  query: {
    plans: {
      findFirst: vi.fn((opts: { columns?: Record<string, boolean> }) => {
        const rec = { table: 'plans', columns: opts?.columns ? Object.keys(opts.columns) : undefined };
        asked.push(rec);
        return Promise.resolve(projectRow(FULL_ROWS.plans, rec.columns));
      }),
    },
  },
};

vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: (fn: (t: Record<string, unknown>) => Promise<unknown>) => fn(tx),
  setTenantContext: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn(() => Promise.resolve('PH-LEAK')),
  createToken: vi.fn(() => Promise.resolve('tok-1')),
  hashToken: vi.fn(() => Promise.resolve('tokhash-1')),
  setSessionCookie: vi.fn(() => Promise.resolve()),
  validatePassword: vi.fn(() => null),
}));

vi.mock('@/lib/modules/auto-install', () => ({
  installDefaultModules: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setup/create-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function runSetup() {
  const { POST } = await import('@/app/api/setup/create-admin/route');
  const res = await POST(makeRequest({
    full_name: 'Ada Admin',
    email: 'admin@example.com',
    password: 'longenough123',
    workspace_name: 'Acme',
  }));
  return { res, json: await res.json() as Record<string, unknown> };
}

beforeEach(() => {
  asked.length = 0;
  vi.resetModules();
});

describe('the projection guard covers this session-free route (#2459)', () => {
  it('is clean under the same rules app/api/public has been under since #2440', () => {
    const source = readFileSync(join(ROOT, REL), 'utf8');
    const found = [];
    for (const h of enumerateHandlers(source, REL)) {
      found.push(
        ...findings(findWriteSites(h.body, REL, h.verb, h.line)),
        ...readFindings(findReadSites(h.body, REL, h.verb, h.line)),
        ...relationalFindings(findRelationalReadSites(h.body, REL, h.verb, h.line)),
      );
    }
    const rest = maskHandlerBodies(source, enumerateHandlers(source, REL));
    found.push(
      ...findings(findWriteSites(rest, REL, 'module', 1)),
      ...readFindings(findReadSites(rest, REL, 'module', 1)),
      ...relationalFindings(findRelationalReadSites(rest, REL, 'module', 1)),
    );
    expect(found.map((f) => `${f.line}: ${f.detail}`)).toEqual([]);
  });

  it('would still catch a reversion, because the guard is what the test calls', () => {
    // Plant the exact shape this PR removed and show the finder fires on it —
    // otherwise the clean run above could be a finder that stopped matching.
    const wide = readFileSync(join(ROOT, REL), 'utf8')
      .replace('.returning({ id: users.id, email: users.email, fullName: users.fullName })', '.returning()');
    expect(wide).not.toContain('fullName: users.fullName');
    const handlers = enumerateHandlers(wide, REL);
    const hits = handlers.flatMap((h) => findings(findWriteSites(h.body, REL, h.verb, h.line)));
    expect(hits).toHaveLength(1);
    expect(hits[0].detail).toContain('RETURNING *');
  });
});

describe('POST /api/setup/create-admin row shapes (#2459)', () => {
  it('names three columns for the super admin it creates', async () => {
    const { res } = await runSetup();
    expect(res.status).toBe(201);
    const userInsert = asked.find((a) => a.table === 'users');
    expect(userInsert?.returning, 'the users insert asked for the whole row back')
      .toEqual(['id', 'email', 'fullName']);
  });

  it('names two for the tenant, one each for the role and the pipeline', async () => {
    await runSetup();
    expect(asked.find((a) => a.table === 'tenants')?.returning).toEqual(['id', 'name']);
    expect(asked.find((a) => a.table === 'roles')?.returning).toEqual(['id']);
    expect(asked.find((a) => a.table === 'pipelines')?.returning).toEqual(['id']);
  });

  it('reads one column of the plan it is looking up', async () => {
    await runSetup();
    const planRead = asked.find((a) => a.table === 'plans');
    expect(planRead, 'the plans read was not recorded').toBeDefined();
    expect(planRead!.columns).toEqual(['id']);
  });

  it('ships no credential in the response body', async () => {
    const { json } = await runSetup();
    const text = JSON.stringify(json);
    for (const value of Object.values(SECRETS)) {
      expect(text, `${String(value)} left the handler`).not.toContain(String(value));
    }
    expect(text).not.toContain('cus_LEAK');
    expect(text).not.toContain('notes_LEAK');
    expect(json.user).toEqual({ id: 'u1', email: 'admin@example.com', full_name: 'Ada Admin', is_super_admin: true });
    expect(json.tenant).toEqual({ id: 't1', name: 'Acme' });
  });

  it('still writes the same rows it wrote before, in the same order', async () => {
    // The projections must not have changed what the route does: ten statements,
    // the super admin first and the session last, with the plan lookup second.
    await runSetup();
    expect(asked.map((a) => a.table)).toEqual([
      'users', 'plans', 'tenants', 'roles', 'tenant_members', 'pipelines',
      'deal_stages', 'roles', 'onboarding_progress', 'sessions',
    ]);
  });
});
