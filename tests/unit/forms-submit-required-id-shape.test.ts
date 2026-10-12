/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2287 — end-to-end (route-level) proof that POST /api/forms/submit enforces
// required fields for BOTH stored shapes:
//   * API-created forms (createFormSchema persists `{ id, label, type, required }`)
//     used to answer 200 even when a required field was missing.
//   * Legacy/seeded forms (`{ key, ... }`) already 400ed (#1160) — must stay so.

const formRow: Record<string, unknown> = {
  id: '0f9d0000-0000-4000-8000-000000000001',
  tenantId: '0f9d0000-0000-4000-8000-000000000002',
  name: 'Probe Form',
  isActive: true,
  fields: [],
  settings: {},
  owner_id: null,
  tenant_status: 'active',
};

const txCalls: string[] = [];

function makeInsertChain() {
  // awaitable values() that also supports .returning() (contacts insert)
  const values = () => {
    const p = Promise.resolve([{ id: '0f9d0000-0000-4000-8000-0000000000aa' }]) as
      Promise<unknown> & { returning?: () => Promise<unknown> };
    p.returning = () => p;
    return p;
  };
  return () => ({ values });
}

const txMock = {
  query: {
    contacts: { findFirst: async () => null },
  },
  insert: makeInsertChain(),
  update: () => ({
    set: () => ({
      where: () => {
        txCalls.push('update');
        return Promise.resolve([]);
      },
    }),
  }),
};

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where']) b[m] = () => b;
      b['limit'] = () => Promise.resolve([{ ...formRow }]);
      return b;
    },
    transaction: async (fn: (tx: typeof txMock) => Promise<unknown>) => {
      txCalls.push('transaction');
      return fn(txMock);
    },
    query: { contacts: { findFirst: async () => null } },
    insert: makeInsertChain(),
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => null),
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn(async () => {}),
}));
vi.mock('@/lib/webhooks', () => ({
  fireWebhooks: vi.fn(async () => {}),
}));
vi.mock('@/lib/formula/sync', () => ({
  syncCalculatedFields: vi.fn(async () => {}),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/forms/submit/route';

function submit(data: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost/api/forms/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ form_id: formRow.id, data }),
    }) as never
  );
}

describe('POST /api/forms/submit — required enforcement (#2287)', () => {
  beforeEach(() => {
    txCalls.length = 0;
  });

  it('(a) 400s an API-created form (id-shaped fields) with a missing required field', async () => {
    formRow.fields = [
      { id: 'email', type: 'email', label: 'Email', required: true },
      { id: 'notes', type: 'textarea', label: 'Notes', required: false },
    ];
    const res = await submit({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing required fields', fields: ['Email'] });
    expect(txCalls).not.toContain('transaction');
  });

  it('(a2) 400s the same id-shaped form when the required value is whitespace', async () => {
    formRow.fields = [{ id: 'email', type: 'email', label: 'Email', required: true }];
    const res = await submit({ email: '   ' });
    expect(res.status).toBe(400);
  });

  it('(b) still 400s legacy key-shaped forms (#1160 behavior preserved)', async () => {
    formRow.fields = [
      { key: 'full_name', type: 'text', label: 'Full Name', required: true },
      { key: 'email', type: 'email', label: 'Email', required: true },
      { key: 'message', type: 'textarea', label: 'Message', required: false },
    ];
    const res = await submit({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Missing required fields',
      fields: ['Full Name', 'Email'],
    });
  });

  it('(c) accepts a submission when required fields are present; non-required may be absent', async () => {
    formRow.fields = [
      { id: 'email', type: 'email', label: 'Email', required: true },
      { id: 'notes', type: 'textarea', label: 'Notes', required: false },
    ];
    const res = await submit({ email: 'lead@example.com' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(txCalls).toContain('transaction');
  });

  it('(c2) accepts a legacy key-shaped submission the same way', async () => {
    formRow.fields = [
      { key: 'full_name', type: 'text', label: 'Full Name', required: true },
      { key: 'email', type: 'email', label: 'Email', required: true },
      { key: 'message', type: 'textarea', label: 'Message', required: false },
    ];
    const res = await submit({ full_name: 'Ada', email: 'ada@example.com' });
    expect(res.status).toBe(200);
  });

  it('(d) honors key-first when a field carries both id and key', async () => {
    formRow.fields = [{ id: '1', key: 'email', type: 'email', label: 'Email', required: true }];
    expect((await submit({})).status).toBe(400);
    expect((await submit({ email: 'a@b.co' })).status).toBe(200);
  });
});
