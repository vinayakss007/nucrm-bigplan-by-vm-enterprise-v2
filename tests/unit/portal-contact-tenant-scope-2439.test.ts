/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2439 — `resolvePortalContact` is the only place the portal's "whose data is
 * this" question is answered, so it carries the two-tenant guarantee.
 *
 * `GET /api/public/invoices` used to look the contact up on `email` alone, and
 * when two workspaces each have a `jane@acme.com` the row `findFirst` reaches
 * first decides whose invoices come back. The shared resolver has scoped to
 * `(email, tenantId)` since #1913; these tests pin that, and pin the #2446
 * seam — a caller that already holds a tenant-context transaction must not have
 * the lookup fall back to the bare pool, where the `contacts` policy either
 * aborts (#2438) or matches nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CONTACT_A = 'a0000000-0000-4000-8000-000000000001';

type Marker = { op: string; args: unknown[] };
type Row = { id: string; tenantId: string };

const captured = vi.hoisted(() => ({ bare: [] as unknown[], onTx: [] as unknown[] }));

const mk = (op: string) => (...args: unknown[]): Marker => ({ op, args });
const colName = (c: unknown) => (c as { name?: string })?.name;

/** Records the where-clause of each `.select().from().where().limit()` chain. */
function recorder(bucket: unknown[], rows: Row[]) {
  return {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => { bucket.push(cond); return { limit: () => Promise.resolve(rows) }; },
      }),
    }),
  };
}

const identity = { email: 'jane@acme.com', tenantId: TENANT_A };

function setup() {
  vi.resetModules();
  captured.bare.length = 0;
  captured.onTx.length = 0;

  vi.doMock('drizzle-orm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('drizzle-orm')>();
    return { ...actual, eq: mk('eq'), and: mk('and'), isNull: mk('isNull'), gt: mk('gt') };
  });
  vi.doMock('@/lib/portal-session', () => ({ getPortalSession: vi.fn() }));
  vi.doMock('@/drizzle/db', () => ({ db: recorder(captured.bare, []) }));

  const rows: Row[] = [];
  return { tx: recorder(captured.onTx, rows), rows };
}

function filters(cond: unknown): Marker[] {
  expect(cond).toBeDefined();
  const and = cond as Marker;
  expect(and.op).toBe('and');
  return and.args as Marker[];
}

describe('resolvePortalContact — (email, tenantId) scoping (#2439 / #1913)', () => {
  beforeEach(() => {
    captured.bare.length = 0;
    captured.onTx.length = 0;
  });

  it('pins the lookup to both the email and the caller’s tenant', async () => {
    const { tx, rows } = setup();
    rows.push({ id: CONTACT_A, tenantId: TENANT_A });
    const { resolvePortalContact } = await import('@/lib/portal-auth');
    await resolvePortalContact(identity, tx as never);

    const fs = filters(captured.onTx[0]);
    expect(fs.find(f => colName(f.args[0]) === 'email')?.args[1]).toBe('jane@acme.com');
    // The tenant predicate is the whole point: the same address in TENANT_B is
    // unreachable from a TENANT_A identity.
    const tenantFilter = fs.find(f => colName(f.args[0]) === 'tenant_id')?.args[1];
    expect(tenantFilter).toBe(TENANT_A);
    expect(tenantFilter).not.toBe(TENANT_B);
    expect(fs.some(f => f.op === 'isNull')).toBe(true);
  });

  it('runs on the caller’s transaction when one is supplied, never on the bare pool', async () => {
    const { tx, rows } = setup();
    rows.push({ id: CONTACT_A, tenantId: TENANT_A });
    const { resolvePortalContact } = await import('@/lib/portal-auth');
    expect(await resolvePortalContact(identity, tx as never)).toEqual({ id: CONTACT_A, tenantId: TENANT_A });
    expect(captured.onTx).toHaveLength(1);
    expect(captured.bare).toHaveLength(0);
  });

  it('still uses the pool for callers that have no context (the pre-#2446 shape)', async () => {
    setup();
    const { resolvePortalContact } = await import('@/lib/portal-auth');
    await resolvePortalContact(identity);
    expect(captured.bare).toHaveLength(1);
    expect(captured.onTx).toHaveLength(0);
  });

  it('resolves a contact that matched nothing to nobody', async () => {
    const { tx } = setup();
    const { resolvePortalContact } = await import('@/lib/portal-auth');
    expect(await resolvePortalContact(identity, tx as never)).toBeNull();
  });
});
