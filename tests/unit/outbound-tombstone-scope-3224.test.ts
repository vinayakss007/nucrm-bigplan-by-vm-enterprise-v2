/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3224 — the outbound paths pick their audience with a query that never asks whether the row is
 * in the trash, and what they do next is send mail.
 *
 * `lib/lead-warming/engine.ts` selects warming recipients on `tenant_id` + `do_not_contact` alone
 * (`getEligibleContacts` and the birthday sweep), and `sendWarmingMessage` reads `contact.email`
 * off whatever came back and enqueues a `send-email` job. There is no contact-side read
 * downstream, so the selector is the only place the exclusion can happen — one assertion below
 * pins that (`addJob` fires for the row the query handed back) instead of trusting the prose.
 *
 * `lib/ai/auto-followup.ts` filters its OWN table with `isNull(followUps.deletedAt)` and then
 * hydrates the contact, company and deal by primary key alone. A deleted contact's name, address
 * and company still enter the prompt, still spend the tenant's AI credits, and still notify the rep.
 *
 * Asserted on the SQL drizzle renders, because a mocked `db` returns whatever it is told: a canned
 * contact row passes with the tombstone predicate missing entirely, which is how this shipped. The
 * `chat` / `addJob` assertions are the companion half — they say what the module does with the set
 * it is handed, so the fix cannot quietly become a silent skip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const READER = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const COMPANY = '55555555-5555-4555-8555-555555555555';
const DEAL = '66666666-6666-4666-8666-666666666666';
const FOLLOW_UP = '77777777-7777-4777-8777-777777777777';
const CAMPAIGN = '88888888-8888-4888-8888-888888888888';
const dialect = new PgDialect({} as never);

type Clause = { table: string; sql: string; params: unknown[] };
let wheres: Clause[] = [];
let queues: Record<string, unknown[][]> = {};
let callAt: Record<string, number> = {};

const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() };

function selectBuilder() {
  const b: Record<string, unknown> = {};
  let table = '?';
  for (const m of ['innerJoin', 'leftJoin', 'orderBy', 'groupBy', 'offset']) b[m] = () => b;
  b['from'] = (t: unknown) => {
    table = (t as { [Symbol.for('drizzle:Name')]?: string })[Symbol.for('drizzle:Name')] ?? '?';
    return b;
  };
  b['limit'] = () => b;
  b['where'] = (predicate: unknown) => {
    const q = dialect.sqlToQuery(predicate as never);
    wheres.push({ table, sql: q.sql, params: q.params as unknown[] });
    return b;
  };
  b['then'] = (resolve: (v: unknown) => unknown) => {
    const q = queues[table] ?? [];
    const i = callAt[table] ?? 0;
    callAt[table] = i + 1;
    return Promise.resolve(q[i] ?? []).then(resolve);
  };
  return b;
}

function setup(rows: Record<string, unknown[][]> = {}) {
  wheres = [];
  callAt = {};
  queues = rows;
  mockDb.select.mockImplementation(() => selectBuilder());
  mockDb.insert.mockImplementation(() => ({
    values: () => ({
      onConflictDoUpdate: () => Promise.resolve({ rowCount: 1 }),
      onConflictDoNothing: () => Promise.resolve({ rowCount: 1 }),
      then: (resolve: (v: unknown) => unknown) => resolve({ rowCount: 1 }),
    }),
  }));
  mockDb.update.mockImplementation(() => ({ set: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }) }));
  mockDb.transaction.mockImplementation((fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb));
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/queue', () => ({ addJob: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai/gateway', () => ({ chat: vi.fn(async () => ({ text: 'draft body', model: 'test' })) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

const { processLeadWarming } = await import('@/lib/lead-warming/engine');
const { processAutoFollowups } = await import('@/lib/ai/auto-followup');
const { addJob } = await import('@/lib/queue');
const { chat } = await import('@/lib/ai/gateway');
const { createNotification } = await import('@/lib/notifications');

/** Every WHERE drizzle built against one table, in call order. */
const forTable = (name: string) => wheres.filter(w => w.table === name);

const eventRow = { id: CAMPAIGN, name: 'Diwali', eventType: 'festival', sendDaysBefore: 0, defaultEmailSubject: 'Happy Diwali' };
const campaignRow = {
  id: CAMPAIGN, tenantId: TENANT, status: 'active', eventIds: [], targetFilter: {},
  enableEmail: true, enableWhatsapp: false, enableSms: false,
  aiGenerateMessages: false, cooldownDays: 7, includeBirthdays: false, totalSent: 0,
};
const contactRow = {
  id: CONTACT, firstName: 'Asha', lastName: 'Rao', email: 'asha@example.test', phone: null,
  companyId: COMPANY, leadStatus: 'customer', tags: [], birthday: null,
  assignedTo: READER, doNotContact: false,
};
const overdueRow = {
  id: FOLLOW_UP, title: 'Check in', missedDays: 2, contactId: CONTACT, dealId: DEAL, assignedTo: READER,
};

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe('#3224 — lead-warming picks its audience out of live contacts', () => {
  it('the campaign selection excludes trashed contacts', async () => {
    setup({
      lead_warming_events: [[eventRow], []],
      lead_warming_campaigns: [[campaignRow]],
      contacts: [[contactRow]],
      lead_warming_schedule: [[], []],
    });
    await processLeadWarming();

    const read = forTable('contacts')[0];
    expect(read, `no contacts read: ${wheres.map(w => w.table).join(',')}`).toBeTruthy();
    expect(read!.sql, read!.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(read!.params).toContain(TENANT);
    // The exclusion adds to the consent check the query already makes; it does not replace it.
    expect(read!.sql).toMatch(/do_not_contact/i);
  });

  it('the birthday sweep excludes trashed contacts too', async () => {
    setup({
      lead_warming_events: [[], []],
      lead_warming_campaigns: [[{ ...campaignRow, includeBirthdays: true }]],
      contacts: [[{ ...contactRow, birthday: new Date('1990-10-24') }]],
      lead_warming_schedule: [[], []],
    });
    await processLeadWarming();

    const read = forTable('contacts')[0];
    expect(read, `no contacts read: ${wheres.map(w => w.table).join(',')}`).toBeTruthy();
    expect(read!.sql, read!.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(read!.params).toContain(TENANT);
    expect(read!.sql).toMatch(/extract\(month from "contacts"\."birthday"/i);
  });

  it('queues the mail straight off the row the selector returned — nothing downstream can fail closed', async () => {
    // Why the predicate belongs in the SELECT: `sendWarmingMessage` never re-reads the contact, so
    // whatever the query hands back is addressed and sent.
    setup({
      lead_warming_events: [[eventRow], []],
      lead_warming_campaigns: [[campaignRow]],
      contacts: [[contactRow]],
      lead_warming_schedule: [[], []],
    });
    await processLeadWarming();
    expect(addJob).toHaveBeenCalledWith('send-email', expect.objectContaining({ to: 'asha@example.test', tenantId: TENANT }));
  });

  it('keeps the audience scoped to the campaign tenant', async () => {
    setup({
      lead_warming_events: [[eventRow], []],
      lead_warming_campaigns: [[{ ...campaignRow, tenantId: OTHER }]],
      contacts: [[]],
    });
    await processLeadWarming();
    expect(forTable('contacts')[0]!.params).toContain(OTHER);
    expect(addJob).not.toHaveBeenCalled();
  });
});

describe('#3224 — AI auto-followup hydrates from live rows only', () => {
  it('the contact, company and deal lookups all exclude trashed rows', async () => {
    setup({
      follow_ups: [[overdueRow]],
      contacts: [[contactRow]],
      companies: [[{ name: 'Acme' }]],
      deals: [[{ title: 'Renewal' }]],
    });
    await processAutoFollowups(TENANT);

    const read = forTable('contacts')[0];
    expect(read, `no contacts read: ${wheres.map(w => w.table).join(',')}`).toBeTruthy();
    expect(read!.sql, read!.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(read!.sql).toMatch(/"contacts"\."id"/);
    expect(read!.params).toContain(CONTACT);
    expect(forTable('companies')[0]!.sql).toMatch(/"companies"\."deleted_at" is null/i);
    expect(forTable('deals')[0]!.sql).toMatch(/"deals"\."deleted_at" is null/i);
  });

  it('a follow-up whose contact no longer resolves is reported as a skip, not drafted', async () => {
    // This is what the predicate above returns for a trashed contact: nothing. Drafting off an
    // empty hydration would still put a reply in the rep's outbox and still bill the tenant for it.
    setup({ follow_ups: [[overdueRow]], contacts: [[]] });
    const results = await processAutoFollowups(TENANT);

    expect(chat).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]!.followUpId).toBe(FOLLOW_UP);
    expect(results[0]!.drafted).toBe(false);
  });

  it('a live contact still drafts and notifies', async () => {
    setup({
      follow_ups: [[overdueRow]],
      contacts: [[contactRow]],
      companies: [[{ name: 'Acme' }]],
      deals: [[{ title: 'Renewal' }]],
    });
    const results = await processAutoFollowups(TENANT);
    expect(results).toEqual([{ followUpId: FOLLOW_UP, drafted: true }]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('a follow-up with no contact at all still drafts — that is not the deleted case', async () => {
    setup({ follow_ups: [[{ ...overdueRow, contactId: null, dealId: null }]] });
    const results = await processAutoFollowups(TENANT);
    expect(results).toEqual([{ followUpId: FOLLOW_UP, drafted: true }]);
    expect(forTable('contacts')).toHaveLength(0);
  });
});

describe('#3224 screen — neither outbound module may read a contact without the tombstone', () => {
  /** Function blocks: a predicate may be built above the query (a `conditions` array) or inline. */
  function blocks(src: string): string[] {
    return src.split(/\n(?=(?:export )?(?:async )?function |^\/\/ ─)/).filter(b => /^\s*(?:export )?(?:async )?function /.test(b));
  }

  it.each(['lib/lead-warming/engine.ts', 'lib/ai/auto-followup.ts'] as const)(
    '%s applies the tombstone in every function that reads a soft-deletable row',
    (file) => {
      const src = readFileSync(file, 'utf8');
      const seen = blocks(src).filter(b => /\.(?:from)\((contacts|companies|deals)\b/.test(b) && !/\.update\(/.test(b));
      expect(seen.length, `${file} has no contacts-reading function`).toBeGreaterThan(0);
      for (const block of seen) {
        for (const table of ['contacts', 'companies', 'deals']) {
          if (!new RegExp(`\\.from\\(${table}\\)`).test(block)) continue;
          expect(block, `${file}: a ${table} read without the tombstone:\n${block.slice(0, 500)}`)
            .toMatch(new RegExp(`isNull\\(${table}\\.deletedAt\\)`));
        }
      }
    },
  );
});
