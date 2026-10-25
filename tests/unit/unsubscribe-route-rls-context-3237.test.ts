/**
 * #3237 — the unsubscribe route must earn its row-level write, in this order.
 *
 * The endpoint's contract is: verify the HMAC over the contact uuid, then flip the
 * opt-out flags, cancel the sequence enrollments, log an activity. Under enforced RLS
 * the first half always worked and the second half never did — three statements on a
 * tenant-keyed table with no context, measured as `UPDATE 0 / UPDATE 0 / 42501`, which
 * surfaced as a 404 "Contact not found" for a contact that exists (#3237).
 *
 * So the recorder below pins the *sequence*, because the sequence is the security
 * property:
 *
 *   1. nothing happens before `verifyUnsubscribeToken` passes — the claim GUC names a
 *      row, and the HMAC is the only thing that says the caller earned it;
 *   2. the claim is opened on the contact from the link, and the `contacts` UPDATE is
 *      the first statement after it;
 *   3. the tenant the two remaining writes run under comes from the CLAIMED ROW, and
 *      the handover that names it is what closes the claim;
 *   4. a contact the claim cannot find is a 404 with no handover and no further writes
 *      — the request never gets to choose a workspace.
 *
 * The token verifier is the real one (`UNSUBSCRIBE_SECRET` is set in `beforeEach`), so
 * the 403 path is an actual failed comparison rather than a stubbed `false`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();

const CONTACT = '3f2b6d1c-8a4e-4f7b-9c2d-1e5a7b3f9d04';
const TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

interface ContextCall { helper: string; contactId?: string; tenantId?: string }
interface Op { kind: string; table: string; set?: Record<string, unknown>; values?: Record<string, unknown> }

const H = vi.hoisted(() => {
  const state = {
    contexts: [] as unknown[],
    ops: [] as unknown[],
    claimRows: [] as unknown[],
  };
  const inject = { render: null as null | ((f: SQL) => { sql: string; params: unknown[] }) };

  const record = (op: Record<string, unknown>, f: SQL) => {
    const p = inject.render ? inject.render(f) : { sql: '', params: [] };
    const table = /"([a-z_]+)"/.exec(p.sql)?.[1] ?? '';
    (state.ops as unknown[]).push({ ...op, table });
  };

  // `UPDATE … .returning()` resolves to the claimed rows; the route reads `tenant_id`
  // off them, which is exactly what 0138's SELECT companion arm makes possible.
  const claimResult = () => {
    const p = Promise.resolve(state.claimRows);
    return Object.assign(p, { returning: () => p });
  };

  const tx: Record<string, unknown> = {
    update: () => {
      const chain: Record<string, unknown> = {};
      chain.set = (values: Record<string, unknown>) => {
        chain.where = (f: SQL) => { record({ kind: 'update', set: values }, f); return claimResult(); };
        return chain;
      };
      return chain;
    },
    insert: (table: { [Symbol.for('drizzle:Name')]?: string; _?: { name?: string } }) => ({
      values: (v: unknown) => {
        const name = table[Symbol.for('drizzle:Name')] ?? table._?.name ?? 'unknown';
        state.ops.push({ kind: 'insert', table: name, values: v });
        return Object.assign(Promise.resolve([]), { returning: () => Promise.resolve([]) });
      },
    }),
    execute: () => Promise.resolve([]),
  };

  return { state, inject, tx, db: { ...tx, transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx) } };
});

H.inject.render = (f: SQL) => dialect.sqlToQuery(f);

vi.mock('@/drizzle/db', () => ({ db: H.db }));

vi.mock('@/lib/db/unsubscribe-contact-context', () => ({
  UNSUBSCRIBE_CONTACT_GUC: 'app.unsubscribe_contact',
  unsubscribeContactValue: (id: string) => id,
  setUnsubscribeContactContext: async (_tx: unknown, contactId: string) => {
    (H.state.contexts as ContextCall[]).push({ helper: 'setUnsubscribeContactContext', contactId });
  },
  setUnsubscribeTenantContext: async (_tx: unknown, tenantId: string) => {
    (H.state.contexts as ContextCall[]).push({ helper: 'setUnsubscribeTenantContext', tenantId });
  },
  withUnsubscribeContactContext: async (contactId: string, fn: (t: unknown) => Promise<unknown>) => {
    (H.state.contexts as ContextCall[]).push({ helper: 'withUnsubscribeContactContext', contactId });
    return fn(H.tx);
  },
}));

vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

const contexts = () => H.state.contexts as ContextCall[];
const ops = () => H.state.ops as Op[];
const req = (query: string) =>
  ({ url: `https://app.example.test/api/unsubscribe?${query}` }) as unknown as NextRequest;

beforeEach(async () => {
  H.state.contexts = [];
  H.state.ops = [];
  H.state.claimRows = [{ id: CONTACT, tenantId: TENANT }];
  process.env.UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
  vi.resetModules();
});

const validToken = async (contactId: string) => {
  const { generateUnsubscribeToken } = await import('@/lib/email/unsubscribe-token');
  return generateUnsubscribeToken(contactId);
};

describe('a verified link performs the opt-out', () => {
  it('claims the named contact, writes the flags, then learns the tenant from the row', async () => {
    const token = await validToken(CONTACT);
    const { GET } = await import('@/app/api/unsubscribe/route');
    const res = await GET(req(`contact=${CONTACT}&token=${token}`));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Unsubscribed');
    expect(contexts().map((c) => c.helper)).toEqual(
      ['withUnsubscribeContactContext', 'setUnsubscribeTenantContext'],
    );
    expect(contexts()[0]!.contactId).toBe(CONTACT);
    expect(ops().map((o) => `${o.kind}:${o.table}`)).toEqual(
      ['update:contacts', 'update:sequence_enrollments', 'insert:activities'],
    );
  });

  it('the contacts write is the opt-out itself, and the claim is closed before anything else runs', async () => {
    const token = await validToken(CONTACT);
    const { GET } = await import('@/app/api/unsubscribe/route');
    await GET(req(`contact=${CONTACT}&token=${token}`));
    const contact = ops()[0];
    expect(contact!.set).toMatchObject({ doNotContact: true, unsubscribed: true });
    // #1120's dedicated flag is the one sequence sends gate on; dropping it would
    // leave a contact "unsubscribed" to this endpoint and still mailed.
    expect(contact!.set).toHaveProperty('unsubscribed', true);
    expect(contexts()[1]!.tenantId).toBe(TENANT);
    expect(ops().length, 'the handover precedes both tenant-scoped writes').toBe(3);
  });

  it('attributes the activity to the claimed row\'s tenant, not to anything the link carried', async () => {
    const token = await validToken(CONTACT);
    const { GET } = await import('@/app/api/unsubscribe/route');
    await GET(req(`contact=${CONTACT}&token=${token}&tenant=${TENANT.replace('a1', 'ff')}`));
    const activity = ops().find((o) => o.kind === 'insert');
    expect(activity!.table).toBe('activities');
    expect(activity!.values).toMatchObject({ tenantId: TENANT, contactId: CONTACT, action: 'unsubscribe' });
  });

  it('RFC 8058 one-click POST takes the same path and answers an empty 200', async () => {
    const token = await validToken(CONTACT);
    const { POST } = await import('@/app/api/unsubscribe/route');
    const res = await POST(req(`contact=${CONTACT}&token=${token}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(ops().map((o) => o.table)).toEqual(['contacts', 'sequence_enrollments', 'activities']);
  });
});

describe('an unverified link earns nothing', () => {
  it('a bad token opens no context and issues no statement', async () => {
    const { GET } = await import('@/app/api/unsubscribe/route');
    const res = await GET(req(`contact=${CONTACT}&token=${'0'.repeat(64)}`));
    expect(res.status).toBe(403);
    expect(contexts()).toEqual([]);
    expect(ops()).toEqual([]);
  });

  it('a missing token is the same refusal', async () => {
    const { POST } = await import('@/app/api/unsubscribe/route');
    const res = await POST(req(`contact=${CONTACT}`));
    expect(res.status).toBe(403);
    expect(contexts()).toEqual([]);
    expect(ops()).toEqual([]);
  });

  it('a token signed for a different contact does not unlock this one', async () => {
    const token = await validToken('9e8d7c6b-5a4f-4e3d-9c8b-7a6f5e4d3c2b');
    const { GET } = await import('@/app/api/unsubscribe/route');
    const res = await GET(req(`contact=${CONTACT}&token=${token}`));
    expect(res.status).toBe(403);
    expect(contexts()).toEqual([]);
  });

  it('a contact the claim cannot find is a 404 with no tenant handover and no further writes', async () => {
    H.state.claimRows = [];
    const token = await validToken(CONTACT);
    const { GET } = await import('@/app/api/unsubscribe/route');
    const res = await GET(req(`contact=${CONTACT}&token=${token}`));
    expect(res.status).toBe(404);
    expect(ops().map((o) => o.table)).toEqual(['contacts']);
    expect(contexts().map((c) => c.helper), 'nothing to learn a tenant from').toEqual(
      ['withUnsubscribeContactContext'],
    );
  });
});

describe('the route no longer writes on an unbound handle', () => {
  it('imports no bare pool, so every statement it sends is inside the claim transaction', () => {
    const src = readFileSync(join(ROOT, 'app/api/unsubscribe/route.ts'), 'utf8');
    expect(src).not.toMatch(/from '@\/drizzle\/db'/);
    expect(src).toMatch(/withUnsubscribeContactContext\(/);
    expect(src).not.toMatch(/\bdb\.(transaction|update|insert|select|delete)/);
  });
});
