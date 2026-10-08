/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2406 — attribution policy and the two queries it rests on.
 *
 * The Resend webhook is signed with one platform-wide secret and its payload
 * names a recipient, not a workspace. This suite pins the decision (exact send
 * → unique mailer → refuse) and asserts against the *rendered* SQL of the real
 * schema (the #2391 technique), so a lookup that stops using an indexed column
 * — or a policy that quietly reverts to "apply everywhere" — fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { emailTracking } from '@/drizzle/schema';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const ADDRESS = 'shared@example.com';
const EMAIL_ID = 'evt_4444444444444444';

const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as never).sql;
const paramsOf = (node: unknown) => dialect.sqlToQuery(node as never).params;

const h = vi.hoisted(() => ({
  nodes: [] as Array<{ kind: string; table: unknown; where?: unknown }>,
  selectRows: [] as unknown[],
}));

function makeChain(kind: string, table: unknown): Record<string, unknown> {
  let where: unknown;
  const record = () => h.nodes.push({ kind, table, where });
  const self: Record<string, unknown> = {
    set: () => self,
    from: (t: unknown) => makeChain(kind, t),
    where: (w: unknown) => { where = w; record(); return self; },
    limit: () => self,
    groupBy: () => self,
    orderBy: () => self,
    returning: () => { record(); return Promise.resolve([]); },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      record();
      return Promise.resolve(kind === 'select' ? h.selectRows : [{}]).then(res, rej);
    },
  };
  return self;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => makeChain('select', undefined),
    update: (t: unknown) => makeChain('update', t),
    insert: (t: unknown) => makeChain('insert', t),
  },
}));

beforeEach(() => {
  h.nodes.length = 0;
  h.selectRows = [];
});

describe('chooseScope — the attribution decision (#2406)', () => {
  it('prefers the exact send the provider named, over every other candidate', async () => {
    const { chooseScope } = await import('@/lib/email/webhook-scope');
    expect(chooseScope({ tenantId: TENANT_A, contactId: CONTACT }, [TENANT_A, TENANT_B]))
      .toEqual({ kind: 'exact', tenantId: TENANT_A, contactId: CONTACT });
  });

  it('falls back to the workspace when the send has no contact row', async () => {
    const { chooseScope } = await import('@/lib/email/webhook-scope');
    expect(chooseScope({ tenantId: TENANT_A, contactId: null }, []))
      .toEqual({ kind: 'tenant', tenantId: TENANT_A });
  });

  it('accepts a recipient only one workspace has ever mailed', async () => {
    const { chooseScope } = await import('@/lib/email/webhook-scope');
    expect(chooseScope(null, [TENANT_B])).toEqual({ kind: 'tenant', tenantId: TENANT_B });
  });

  it('dedupes repeated sends to the same workspace', async () => {
    const { chooseScope } = await import('@/lib/email/webhook-scope');
    expect(chooseScope(null, [TENANT_B, TENANT_B, TENANT_B])).toEqual({ kind: 'tenant', tenantId: TENANT_B });
  });

  it('refuses to guess between two workspaces that both mailed the address', async () => {
    const { chooseScope } = await import('@/lib/email/webhook-scope');
    expect(chooseScope(null, [TENANT_B, TENANT_A]))
      .toEqual({ kind: 'unattributed', reason: 'ambiguous', candidates: [TENANT_A, TENANT_B] });
  });

  it('refuses to write when no workspace mailed the address', async () => {
    const { chooseScope } = await import('@/lib/email/webhook-scope');
    expect(chooseScope(null, []))
      .toEqual({ kind: 'unattributed', reason: 'no-send-record', candidates: [] });
  });

  it('ignores a blank tenant id instead of treating it as a workspace', async () => {
    const { chooseScope } = await import('@/lib/email/webhook-scope');
    expect(chooseScope(null, ['', TENANT_A])).toEqual({ kind: 'tenant', tenantId: TENANT_A });
  });
});

describe('the attribution queries use the indexed columns (#2406)', () => {
  it('resolves by provider message id when the event carries one', async () => {
    const { resolveRecipientScope } = await import('@/lib/email/webhook-scope');
    h.selectRows = [{ tenantId: TENANT_A, contactId: CONTACT }];
    const scope = await resolveRecipientScope({ emailId: EMAIL_ID, recipient: ADDRESS });

    expect(scope).toEqual({ kind: 'exact', tenantId: TENANT_A, contactId: CONTACT });
    const select = h.nodes.find((n) => n.kind === 'select' && n.where !== undefined)!;
    expect(render(select.where)).toContain('"message_id"');
    expect(paramsOf(select.where)).toContain(EMAIL_ID);
  });

  it('does not scan by recipient when the message id already resolved it', async () => {
    const { resolveRecipientScope } = await import('@/lib/email/webhook-scope');
    h.selectRows = [{ tenantId: TENANT_A, contactId: CONTACT }];
    await resolveRecipientScope({ emailId: EMAIL_ID, recipient: ADDRESS });
    expect(h.nodes.some((n) => n.kind === 'select' && n.where !== undefined && render(n.where).includes('recipient')))
      .toBe(false);
  });

  it('matches the recipient case-insensitively and collapses to distinct tenants', async () => {
    const { resolveRecipientScope } = await import('@/lib/email/webhook-scope');
    h.selectRows = [{ tenantId: TENANT_A }, { tenantId: TENANT_B }];
    const scope = await resolveRecipientScope({ emailId: null, recipient: ADDRESS.toUpperCase() });

    expect(scope).toEqual({ kind: 'unattributed', reason: 'ambiguous', candidates: [TENANT_A, TENANT_B] });
    const select = h.nodes.filter((n) => n.kind === 'select' && n.where !== undefined).at(-1)!;
    // drizzle renders the function name exactly as the SQL fragment writes it,
    // so the assertion carries the same uppercase LOWER the library emits.
    expect(render(select.where)).toContain('LOWER("email_tracking"."recipient")');
    // The address arrives lower-cased by the caller and is compared as such;
    // the SQL side lowercases the stored value, so mixed-case sends still hit.
    expect(paramsOf(select.where)).toContain(ADDRESS);
    expect(render(select.where)).toContain('email_tracking');
  });

  it('reads the tenant and contact from email_tracking, the table that has both', async () => {
    const { resolveRecipientScope } = await import('@/lib/email/webhook-scope');
    h.selectRows = [];
    await resolveRecipientScope({ emailId: null, recipient: ADDRESS });
    const select = h.nodes.find((n) => n.kind === 'select')!;
    expect(select.table).toBe(emailTracking);
  });
});
