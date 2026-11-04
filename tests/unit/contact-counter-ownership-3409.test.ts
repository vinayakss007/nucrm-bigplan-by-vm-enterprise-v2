/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3409 — `tenants.currentContacts` had no owner.
 *
 * The column is what the plan gate prices against (`maxContacts`), but it is
 * maintained by hand at a dozen call sites and nothing said that a code path
 * which ADDS a contact row owes a bump. Six insert paths never paid: the public
 * API (`/api/v1/contacts`), inbound webhooks, chat-to-lead conversion, the lead
 * resolver, and the super-admin restore (two branches). Each admitted a row and
 * left the counter behind, so the number drifted low and every later quota
 * check measured a tenant smaller than it was.
 *
 * The other half is the read: `POST /api/tenant/contacts` tested the limit and
 * then inserted in a separate statement, so two concurrent creates both passed
 * the same check and both committed. #3080 and #3147 already fixed that shape
 * on the lead doors — lock the tenant row `FOR UPDATE`, decide, then write — and
 * the contacts door never received it.
 *
 * What is held here, in order:
 *   A. every file that inserts a contact owns the bump — a repo-wide scan with a
 *      floor, so it cannot pass by quietly matching nothing, and one that
 *      ignores comments;
 *   B. the shared resolver pays for the row it admits, proven by running it
 *      against a fake transaction;
 *   C. its callers must not pay again — the fix is only right if it does not
 *      double-count;
 *   D. the quota decision happens under the row lock, inside the transaction
 *      that writes.
 */
import { describe, it, expect } from 'vitest';
import { SQL } from 'drizzle-orm';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname!, '..', '..');

const INSERTS_CONTACTS = /\.insert\(\s*(?:schema\.)?contacts\s*\)/;
const BUMPS_CONTACTS = /currentContacts\s*:\s*(?:sql|COALESCE)/;
const CALLS_RESOLVER = /resolveOrCreateContactForLead\s*\(/;

/**
 * Comment lines are not call sites: `lib/api/bulk-operations.ts:31` documents an
 * `insert(contacts)` in its header prose and never executes one.
 */
function codeLines(src: string): string[] {
  return src.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function filesUnder(rootDir: string, relDirs: string[]): string[] {
  return relDirs.flatMap((sub) => walk(join(rootDir, sub))).map((f) => f.slice(rootDir.length + 1));
}

/** Files that add a contact row. */
function contactInsertFiles(rootDir: string): string[] {
  return filesUnder(rootDir, ['app', 'lib'])
    .filter((rel) => codeLines(readFileSync(join(rootDir, rel), 'utf8')).some((l) => INSERTS_CONTACTS.test(l)))
    .sort();
}

/** Files that add a contact row and never touch the counter that row is counted by. */
function orphanInsertFiles(rootDir: string): string[] {
  return contactInsertFiles(rootDir).filter(
    (rel) => !codeLines(readFileSync(join(rootDir, rel), 'utf8')).some((l) => BUMPS_CONTACTS.test(l)),
  );
}

/** Plant a throwaway tree, so the scanner itself can be shown failing. */
function mkTree(files: Record<string, string>): string {
  const dir = mkdtempSync('/tmp/contact-counter-');
  for (const [relPath, src] of Object.entries(files)) {
    const abs = join(dir, relPath);
    mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
    writeFileSync(abs, src);
  }
  return dir;
}

// Below today's count, above what a parser that silently stopped early would
// produce. The scan is only a screen while it still sees the sites.
const MIN_INSERT_FILES = 10;

describe('#3409 A — whoever inserts a contact owns the counter', () => {
  it('finds the insert sites, so the rule below cannot pass by matching nothing', () => {
    const found = contactInsertFiles(ROOT);
    expect(found.length).toBeGreaterThanOrEqual(MIN_INSERT_FILES);
    for (const expected of [
      'app/api/forms/submit/route.ts',
      'app/api/tenant/contacts/route.ts',
      'app/api/v1/contacts/route.ts',
      'app/api/webhooks/inbound/route.ts',
      'lib/chat.ts',
      'lib/contacts/resolve.ts',
      'lib/leads/convert.ts',
      'lib/import/contacts.ts',
    ]) {
      expect(found, `${expected} inserts contacts and must be scanned`).toContain(expected);
    }
  });

  it('has no insert path that leaves the counter behind', () => {
    expect(orphanInsertFiles(ROOT), 'these files add contacts without bumping tenants.currentContacts').toEqual([]);
  });

  it('sees an orphan it planted, and ignores a comment that only mentions an insert', () => {
    const dir = mkTree({
      'app/api/paid/route.ts': [
        'await tx.insert(contacts).values(row);',
        'await tx.update(tenants).set({ currentContacts: sql`x + 1` });',
      ].join('\n'),
      'app/api/orphan/route.ts': 'await tx.insert(contacts).values(row);',
      'lib/just-a-comment.ts': ' * const [c] = await db.insert(contacts).values(validated).returning();',
    });
    try {
      expect(contactInsertFiles(dir)).toEqual(['app/api/orphan/route.ts', 'app/api/paid/route.ts']);
      expect(orphanInsertFiles(dir)).toEqual(['app/api/orphan/route.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#3409 C — the resolver owns the bump its callers used to skip or duplicate', () => {
  const RESOLVER_CALLERS = ['app/api/tenant/leads/import/route.ts', 'app/api/tenant/leads/route.ts'];

  it('is called from exactly the two lead doors that create contacts', () => {
    const found = filesUnder(ROOT, ['app', 'lib'])
      .filter((rel) => !rel.endsWith('lib/contacts/resolve.ts'))
      .filter((rel) => CALLS_RESOLVER.test(readFileSync(join(ROOT, rel), 'utf8')))
      .sort();
    expect(found).toEqual(RESOLVER_CALLERS);
  });

  it('leaves the counter alone in every one of those callers', () => {
    // The import door bumped after `resolve` reported isNewContact; the POST door
    // never bumped at all. With the payment inside the resolver, a caller that
    // kept paying would add 2 for one contact.
    for (const rel of RESOLVER_CALLERS) {
      const bumps = codeLines(readFileSync(join(ROOT, rel), 'utf8')).filter((l) => BUMPS_CONTACTS.test(l));
      expect(bumps, `${rel} must let lib/contacts/resolve.ts own the bump`).toEqual([]);
    }
  });

  it('keeps the FOR UPDATE quota read the import door already had', () => {
    // Dropping the bump must not quietly drop #3080's gate with it. The plain
    // POST door is exempt: it gates on the leads pool (`checkLimit(ctx, 'leads')`,
    // app/api/tenant/leads/route.ts:231), not on the contacts counter, so it has
    // no ceiling read of its own to lose.
    const src = readFileSync(join(ROOT, 'app/api/tenant/leads/import/route.ts'), 'utf8');
    expect(src).toMatch(/\.for\(\s*'update'\s*\)/);
    expect(src).toMatch(/maxContacts/);
  });
});

// ── B: the shared resolver, run against a fake transaction ───────────────────

type Event = { op: string; patch?: Record<string, unknown> };

/**
 * The real shape of the helper is:
 *   tx.query.contacts.findFirst(...) → tx.insert(contacts).values(...).returning({id})
 *                                    → tx.update(tenants).set({ currentContacts: sql… })
 * so the fake has to be thenable at every step and must record the objects it
 * was handed, because the assertion is about which SQL-side patch ran, not
 * about how the table was spelled.
 */
function fakeTx(existing: Record<string, unknown> | null) {
  const events: Event[] = [];
  const returned = [{ id: 'contact-1' }];
  const chain = (label: string, payload: unknown): unknown =>
    Object.assign(Promise.resolve(payload), {
      values: (patch: Record<string, unknown>) => {
        events.push({ op: `${label}:values`, patch });
        return chain(label, returned);
      },
      returning: async () => {
        events.push({ op: `${label}:returning` });
        return returned;
      },
      set: (patch: Record<string, unknown>) => {
        events.push({ op: `${label}:set`, patch });
        return { where: async () => undefined };
      },
    });
  return {
    events,
    tx: {
      query: {
        contacts: {
          findFirst: async () => {
            events.push({ op: 'select:contacts' });
            return existing;
          },
        },
        companies: { findFirst: async () => null },
      },
      insert: (table: { __name?: string }) => {
        events.push({ op: `insert:${table?.__name ?? 'contacts'}` });
        return chain('insert', returned);
      },
      update: (table: { __name?: string }) => {
        events.push({ op: `update:${table?.__name ?? '?'}` });
        return chain('update', undefined);
      },
    },
  };
}

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '20000000-0000-0000-0000-000000000001';
const LEAD = { firstName: 'Ada', lastName: 'L', email: 'Ada@Example.test ' };

function counterPatches(events: Event[]): Array<Record<string, unknown>> {
  return events
    .filter((e) => e.op === 'update:set' && e.patch && 'currentContacts' in e.patch)
    .map((e) => e.patch as Record<string, unknown>);
}

describe('#3409 B — resolveOrCreateContactForLead pays for the row it admits', () => {
  it('bumps the counter exactly once, after inserting, when it creates the contact', async () => {
    const { resolveOrCreateContactForLead } = await import('@/lib/contacts/resolve');
    const { events, tx } = fakeTx(null);

    const out = await resolveOrCreateContactForLead(
      tx as never,
      TENANT_ID,
      USER_ID,
      LEAD as never,
    );

    expect(out.isNewContact).toBe(true);
    const paid = counterPatches(events);
    expect(paid, `expected one counter bump; ops were ${events.map((e) => e.op).join(' | ')}`).toHaveLength(1);
    // The bump is an SQL expression, not a JS number read off a row and added to
    // (#2344) — that is the whole difference between "atomic" and "loses writes".
    expect(paid[0].currentContacts, 'counter bump must be SQL-side').toBeInstanceOf(SQL);
    const insertAt = events.findIndex((e) => e.op.startsWith('insert:'));
    const payAt = events.findIndex((e) => e.op === 'update:set' && !!e.patch && 'currentContacts' in e.patch);
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(payAt).toBeGreaterThan(insertAt);
  });

  it('does not bump when it matched an existing contact', async () => {
    const { resolveOrCreateContactForLead } = await import('@/lib/contacts/resolve');
    const { events, tx } = fakeTx({ id: 'existing-1', score: 0, phone: 'x', jobTitle: 'y', companyId: null, linkedinUrl: 'z' });

    const out = await resolveOrCreateContactForLead(tx as never, TENANT_ID, USER_ID, LEAD as never);

    expect(out.isNewContact).toBe(false);
    expect(out.contactId).toBe('existing-1');
    expect(counterPatches(events)).toEqual([]);
  });
});

// ── D: the quota decision happens where the write happens ────────────────────

describe('#3409 D — POST /api/tenant/contacts decides inside the transaction it writes in', () => {
  const rel = 'app/api/tenant/contacts/route.ts';
  const lines = () => readFileSync(join(ROOT, rel), 'utf8').split('\n').map((l) => l.trim());

  it('locks the tenant row FOR UPDATE before it inserts, inside that transaction', () => {
    const src = lines();
    const txAt = src.findIndex((l) => /db\.transaction\(/.test(l));
    const insertAt = src.findIndex((l) => /tx\.insert\(\s*contacts\s*\)/.test(l));
    const lockAt = src.findIndex((l, i) => i > txAt && /\.for\(\s*'update'\s*\)/.test(l));

    expect(txAt, 'no transaction on the create path').toBeGreaterThan(-1);
    expect(insertAt, 'no contact insert').toBeGreaterThan(txAt);
    expect(lockAt, 'the tenant row is never locked inside the transaction').toBeGreaterThan(txAt);
    expect(lockAt, 'the lock is taken after the insert, which does not serialise anything').toBeLessThan(insertAt);
  });

  it('prices the ceiling against the counter the lock just read', () => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const inside = src.slice(src.indexOf('db.transaction('));
    expect(inside).toMatch(/maxContacts/);
    expect(inside).toMatch(/currentContacts/);
  });

  it('keeps the pre-flight checkLimit, which records the violation and alerts the owner', () => {
    // The in-transaction re-check is a backstop, not a replacement: checkLimit is
    // what writes the usage_violations row and calls notifyLimitHit, and a
    // request stopped only by the backstop must not skip both.
    expect(readFileSync(join(ROOT, rel), 'utf8')).toMatch(/await checkLimit\(ctx,\s*'contacts'\)/);
  });
});

describe('#3409 E — the transaction fence refuses with the response checkLimit refuses with', () => {
  const rel = 'app/api/tenant/contacts/route.ts';
  const src = () => readFileSync(join(ROOT, rel), 'utf8');

  it('returns the shared plan-limit response instead of a second copy of the body', () => {
    expect(src()).toMatch(/planLimitReachedResponse\(\s*'contacts'/);
  });

  it('does not hand-roll the billing redirect in the route', () => {
    const handRolled = codeLines(src()).filter((l) => /upgradeUrl/.test(l));
    expect(handRolled, 'the 402 body has exactly one owner: lib/usage/middleware').toEqual([]);
  });

  it('COALESCE-guards its own bump — a NULL counter must not increment into NULL', () => {
    const bumps = codeLines(src()).filter((l) => BUMPS_CONTACTS.test(l));
    expect(bumps.length, 'expected exactly one counter bump on the create path').toBe(1);
    expect(bumps[0]).toMatch(/COALESCE/);
  });
});

describe('#3409 F — the superadmin restore reports the rows it admitted, not the chunk size', () => {
  const rel = 'app/api/superadmin/user-data/route.ts';
  const src = () => readFileSync(join(ROOT, rel), 'utf8');

  it('counts a restored set from what the insert returns', () => {
    // `onConflictDoNothing()` can admit fewer rows than the chunk asked for, so
    // chunk.length overstates both the report and any counter priced against it.
    const byChunk = codeLines(src()).filter((l) => /restored\s*\+=\s*chunk\.length/.test(l));
    expect(byChunk, 'a restore must count admitted rows, not requested rows').toEqual([]);
    expect(src()).toMatch(/returning\(/);
  });

  it('prices the contact counter by what this door admitted', () => {
    expect(src()).toMatch(/currentContacts:\s*sql`COALESCE\(\$\{tenants\.currentContacts\}, 0\) \+ \$\{contactsRestored\}`/);
  });

  it('prices the deal counter by what this door admitted', () => {
    expect(src()).toMatch(/currentDeals:\s*sql`COALESCE\(\$\{tenants\.currentDeals\}, 0\) \+ \$\{dealsRestored\}`/);
  });
});
