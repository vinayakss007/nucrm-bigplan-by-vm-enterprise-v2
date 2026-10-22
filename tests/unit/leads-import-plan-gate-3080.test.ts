/**
 * #3080 — leads CSV import plan-limit enforcement.
 * The old shape ran the `FOR UPDATE` gate in its own transaction that
 * committed before any row existed, and `resolveOrCreateContactForLead`
 * inserted contacts without ever touching `tenants.currentContacts`. The
 * gate must now be taken INSIDE the per-row transaction (tenant row locked,
 * quota enforced after resolve, counter incremented in SQL) so a quota
 * breach rolls the row back instead of silently over-allocating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  insertedLeads: 0,
  newContact: true,
}));

vi.mock('@/drizzle/db', () => {
  const mkChain = (rows: () => unknown[]) => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      for: () => Promise.resolve(rows()),
      then: (res?: (v: unknown) => unknown, rej?: (r: unknown) => unknown) => Promise.resolve(rows()).then(res, rej),
    };
    return chain;
  };
  const db: Record<string, unknown> = {
    select: () => mkChain(() => h.selectQueue.shift() ?? []),
    update: () => {
      const chain: Record<string, unknown> = {
        set: (p: Record<string, unknown>) => { h.updates.push(p); return chain; },
        where: () => Promise.resolve(),
        returning: async () => [],
      };
      return chain;
    },
    insert: () => {
      const chain: Record<string, unknown> = {
        values: () => chain,
        returning: async () => [{ id: 'l-1' }],
      };
      return chain;
    },
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
    query: {},
  };
  return { db };
});
vi.mock('@/lib/contacts/resolve', () => ({
  resolveOrCreateContactForLead: async () => ({ contactId: 'c-1', companyId: null, isNewContact: h.newContact }),
}));
vi.mock('@/lib/leads/oid', () => ({
  generateLeadOid: async () => 'LEAD-0001',
  isLeadOidCollision: () => false,
}));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: async (req: Request) => JSON.parse(await req.text()),
  validateBody: (_s: unknown, body: unknown) => ({ data: body as object }),
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: async (_ctx: unknown, _entity: unknown, body: Record<string, unknown>) => ({ body, stripped: [] }),
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({ userId: 'u-1', tenantId: 'tenant-1', email: 'a@b.com', isAdmin: true, isSuperAdmin: false }),
  requirePerm: () => null,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => Promise.resolve(null) }));
vi.mock('@/lib/audit', () => ({ logAudit: () => Promise.resolve() }));
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));

function req(csv: string) {
  return new Request('http://localhost/api/tenant/leads/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv }),
  }) as unknown as NextRequest;
}

const CSV = 'first_name,email\nAda,ada@example.com';

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue = [];
  h.updates = [];
  h.insertedLeads = 0;
  h.newContact = true;
});

async function run() {
  const { POST } = await import('@/app/api/tenant/leads/import/route');
  const res = await POST(req(CSV));
  expect(res.status).toBe(200);
  const body = await res.json() as { ok: boolean; results: Record<string, number | string[]> };
  expect(body.ok).toBe(true);
  return body.results;
}

describe('leads import plan gate (#3080)', () => {
  it('enforces the gate inside the row tx and bumps currentContacts for a new contact', async () => {
    // order of selects: pre-check gate, existing-lead dedupe, per-row FOR UPDATE lock
    h.selectQueue = [
      [{ currentContacts: 0, maxContacts: 10 }],
      [],
      [{ currentContacts: 0, maxContacts: 10 }],
    ];
    const out = await run();
    expect(out.imported).toBe(1);
    expect(out.newContacts).toBe(1);
    const counterBump = h.updates.find((u) => 'currentContacts' in u);
    expect(counterBump, 'tenants.currentContacts must be incremented in SQL').toBeDefined();
    const rendered = new PgDialect().sqlToQuery(
      (counterBump as { currentContacts: never }).currentContacts).sql;
    expect(rendered).toMatch(/COALESCE\("?(?:tenants"\."?)?current_contacts"?, 0\) \+ 1/i);
  });

  it('rolls the row past the gate instead of inserting when quota is hit mid-import', async () => {
    h.selectQueue = [
      [{ currentContacts: 9, maxContacts: 10 }], // pre-check: 9 + 1 row fits
      [],
      [{ currentContacts: 10, maxContacts: 10 }], // per-row lock: a concurrent import already filled it
    ];
    const out = await run();
    expect(out.imported).toBe(0);
    expect(out.skipped).toBe(1);
    expect((out.errors as string[]).join(' ')).toMatch(/Plan contact limit reached/);
    expect(h.updates.find((u) => 'currentContacts' in u)).toBeUndefined();
  });

  it('does not bump the counter when the row merged into an existing contact', async () => {
    h.newContact = false;
    h.selectQueue = [
      [{ currentContacts: 3, maxContacts: 10 }],
      [],
      [{ currentContacts: 3, maxContacts: 10 }],
    ];
    const out = await run();
    expect(out.imported).toBe(1);
    expect(out.mergedContacts).toBe(1);
    expect(h.updates.find((u) => 'currentContacts' in u)).toBeUndefined();
  });
});
